import { fetchMock } from '../api/testUtils.ts';
import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Thumbnail from './Thumbnail.svelte';
import { setAuthHooks } from '../api/client.ts';

const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const OBJECT_URL = 'blob:http://localhost/thumb';

let revoke: ReturnType<typeof vi.fn>;

function png(status = 200): Response {
  return new Response(status === 200 ? 'bytes' : null, {
    status,
    headers: { 'Content-Type': 'image/png' },
  });
}

function authorization(): string | null {
  const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
  const headers = new Headers(request?.headers);
  return headers.get('authorization');
}

beforeEach(() => {
  fetchMock.mockReset();
  revoke = vi.fn();
  // Only the two statics, never the whole global: URL is a constructor the
  // fetch internals call.
  const statics = URL as unknown as Record<string, unknown>;
  statics.createObjectURL = vi.fn(() => OBJECT_URL);
  statics.revokeObjectURL = revoke;
  setAuthHooks({ getToken: () => 'tok', onUnauthorized: () => {} });
});

afterEach(() => {
  const statics = URL as unknown as Record<string, unknown>;
  delete statics.createObjectURL;
  delete statics.revokeObjectURL;
  // Deliberately not vi.unstubAllGlobals(): fetch, Request and the storage
  // objects are stubbed once for the whole suite in api/testUtils.ts, and
  // restoring them here hands the next case jsdom's real fetch.
});

describe('Thumbnail', () => {
  // The bug this exists for: an <img src="/api/..."> is a request the browser
  // starts, and it carries no Authorization header, so every thumbnail in the
  // explorer was a 401.
  it('reads the bytes with the credential and shows them', async () => {
    fetchMock.mockImplementation(async () => png());

    render(Thumbnail, { props: { fileId: FILE } });

    await waitFor(() => expect(screen.getByRole('presentation')).toBeInTheDocument());
    expect(authorization()).toBe('Bearer tok');
    expect(screen.getByRole('presentation')).toHaveAttribute('src', OBJECT_URL);
  });

  it('stays a placeholder when the bytes cannot be read', async () => {
    fetchMock.mockImplementation(async () => png(403));

    render(Thumbnail, { props: { fileId: FILE } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });

  // An explorer scrolled through a folder of images would otherwise leak one
  // object URL per row for as long as the tab is open.
  it('revokes the object URL when it goes away', async () => {
    fetchMock.mockImplementation(async () => png());

    const view = render(Thumbnail, { props: { fileId: FILE } });
    await waitFor(() => expect(screen.getByRole('presentation')).toBeInTheDocument());
    view.unmount();

    expect(revoke).toHaveBeenCalledWith(OBJECT_URL);
  });

  function requested(): string[] {
    return fetchMock.mock.calls.map((call) =>
      typeof call[0] === 'string' ? call[0] : (call[0] as Request).url
    );
  }

  it('asks for the version it was given', async () => {
    fetchMock.mockImplementation(async () => png());

    render(Thumbnail, { props: { fileId: FILE, version: 2 } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(requested()[0]).toContain(`/api/files/${FILE}/download?version=2`);
  });

  // The trap this pins: a prop read only inside the async closure is not a
  // dependency of the effect, so the frame keeps the first version for ever.
  it('fetches again when the version changes', async () => {
    fetchMock.mockImplementation(async () => png());

    const view = render(Thumbnail, { props: { fileId: FILE, version: 1 } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await view.rerender({ fileId: FILE, version: 3 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requested()[1]).toContain('?version=3');
  });

  // jsdom has no IntersectionObserver, so every case above takes the branch that
  // reads immediately. This one supplies the observer the browser has.
  describe('where the engine can say what is on screen', () => {
    const observed: Element[] = [];
    let fire: ((entries: { isIntersecting: boolean }[]) => void) | null = null;

    beforeEach(() => {
      observed.length = 0;
      fire = null;
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
            fire = callback;
          }
          observe(node: Element): void {
            observed.push(node);
          }
          disconnect(): void {}
        }
      );
    });

    afterEach(() => {
      vi.stubGlobal('IntersectionObserver', undefined);
    });

    it('reads nothing until the row has been scrolled to', async () => {
      fetchMock.mockImplementation(async () => png());

      render(Thumbnail, { props: { fileId: FILE } });

      expect(observed).toHaveLength(1);
      expect(fetchMock).not.toHaveBeenCalled();

      fire?.([{ isIntersecting: true }]);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });
  });
});
