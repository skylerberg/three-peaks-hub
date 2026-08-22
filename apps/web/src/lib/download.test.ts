import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './download.ts';

const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OBJECT_URL = 'blob:http://localhost/abc';

let revoke: ReturnType<typeof vi.fn>;
let clicked: HTMLAnchorElement[];

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  revoke = vi.fn();
  // Only the two statics, never the whole global: URL is a constructor that
  // the fetch internals call, and replacing it wholesale breaks every request.
  const statics = URL as unknown as Record<string, unknown>;
  statics.createObjectURL = vi.fn(() => OBJECT_URL);
  statics.revokeObjectURL = revoke;

  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.useRealTimers();
  const statics = URL as unknown as Record<string, unknown>;
  delete statics.createObjectURL;
  delete statics.revokeObjectURL;
  vi.restoreAllMocks();
});

function bytes(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('downloadFile', () => {
  it('sends the credential the API needs, which a browser navigation would not', async () => {
    fetchMock.mockResolvedValueOnce(bytes('ace of spades'));
    await downloadFile(FILE, 'card.txt');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/files/${FILE}/download`);
    expect(init.headers).toBeDefined();
    expect(clicked[0].download).toBe('card.txt');
  });

  // The whole reason this helper exists rather than an <a href>: only Chromium
  // takes its reference to the blob during the click. Revoking in the same task
  // leaves Firefox and WebKit downloading nothing, and no browser reports it.
  it('defers revoking the object URL until after the click', async () => {
    fetchMock.mockResolvedValueOnce(bytes('ace of spades'));
    await downloadFile(FILE, 'card.txt');

    expect(clicked).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('asks for one version rather than the current bytes when given a number', async () => {
    fetchMock.mockResolvedValueOnce(bytes('older'));
    await downloadFile(FILE, 'card.v1.txt', 1);

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/files/${FILE}/download?version=1`);
  });

  it('reports the server error rather than saving an error page', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Version not found' }));

    await expect(downloadFile(FILE, 'card.txt', 99)).rejects.toThrow('Version not found');
    expect(clicked).toHaveLength(0);
    vi.runAllTimers();
    expect(revoke).not.toHaveBeenCalled();
  });
});
