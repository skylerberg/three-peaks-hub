import '../api/testUtils.ts';
import { FakeWebSocket, fetchMock, jsonResponse } from '../api/testUtils.ts';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FileVersions from './FileVersions.svelte';
import { realtime } from '../lib/realtime.svelte.ts';
import { versions } from '../lib/versions.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MEMBER = 'aa11bb22-cc33-4d44-8e55-ff66aa77bb88';

const FILE_ROW = {
  id: FILE,
  project_id: PROJECT,
  folder_id: null,
  filename: 'ace.png',
  content_type: 'image/png',
  byte_size: 4096,
  image_width: 100,
  image_height: 140,
  name_locked: false,
  deleted_at: null,
  uploaded_by: MEMBER,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-03T00:00:00.000Z',
};

function version(number: number, current: boolean, bytes: number) {
  return {
    file_id: FILE,
    version_number: number,
    byte_size: bytes,
    checksum: null,
    content_type: 'image/png',
    image_width: 100,
    image_height: 140,
    is_current: current,
    created_by: MEMBER,
    created_at: `2026-01-0${number}T00:00:00.000Z`,
  };
}

const HISTORY = [version(3, true, 4096), version(2, false, 2048), version(1, false, 1024)];

function downloads(): string[] {
  return fetchMock.mock.calls
    .map((call) => (typeof call[0] === 'string' ? call[0] : (call[0] as Request).url))
    .filter((url) => url.includes('/download'));
}

beforeEach(() => {
  fetchMock.mockReset();
  FakeWebSocket.reset();
  versions.reset();
  const statics = URL as unknown as Record<string, unknown>;
  statics.createObjectURL = vi.fn(() => 'blob:http://localhost/thumb');
  statics.revokeObjectURL = vi.fn();

  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/download')) {
      return new Response('bytes', { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    if (url.includes(`/api/files/${FILE}/versions`)) {
      return jsonResponse(200, { versions: HISTORY });
    }
    if (url.includes(`/api/files/${FILE}`)) return jsonResponse(200, FILE_ROW);
    if (url.includes(`/api/projects/${PROJECT}/members`)) {
      return jsonResponse(200, {
        members: [
          {
            user_id: MEMBER,
            name: 'Skyler',
            email: 'x@example.com',
            role: 'editor',
            is_creator: true,
          },
        ],
      });
    }
    return jsonResponse(404, { error: `nothing stubbed for ${url}` });
  });
});

afterEach(() => {
  realtime.stop();
  const statics = URL as unknown as Record<string, unknown>;
  delete statics.createObjectURL;
  delete statics.revokeObjectURL;
});

async function openAndPick(numbers: number[]): Promise<void> {
  render(FileVersions, { projectId: PROJECT, fileId: FILE });
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3));
  for (const number of numbers) {
    await fireEvent.click(
      screen.getByRole('button', { name: `Compare version ${number} of ace.png` })
    );
  }
}

describe('Comparing two versions', () => {
  it('puts two chosen versions side by side with their sizes and dates', async () => {
    await openAndPick([3, 1]);

    // Ascending, whichever order they were picked in: older on the left.
    const heading = await waitFor(() =>
      screen.getByRole('heading', { name: 'Version 1 and version 3', level: 2 })
    );
    const panel = heading.closest('section');
    expect(panel).not.toBeNull();
    expect(panel).toHaveTextContent('1.0 KB');
    expect(panel).toHaveTextContent('4.0 KB');
    expect(panel).toHaveTextContent('Skyler');
    expect(panel?.querySelectorAll('time')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /for comparison$/u })).toHaveLength(2);
  });

  // Walking backwards down a stack should not mean clearing the pair at every
  // step, so a third pick drops the older of the two rather than being refused.
  it('replaces the older choice when a third version is picked', async () => {
    await openAndPick([3, 2, 1]);

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Version 1 and version 2', level: 2 })
      ).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Compare version 3 of ace.png' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('draws each side at its own version, not the current file', async () => {
    await openAndPick([3, 1]);

    await waitFor(() => expect(downloads()).toHaveLength(2));
    expect(downloads().some((url) => url.endsWith('/download?version=3'))).toBe(true);
    expect(downloads().some((url) => url.endsWith('/download?version=1'))).toBe(true);
  });
});
