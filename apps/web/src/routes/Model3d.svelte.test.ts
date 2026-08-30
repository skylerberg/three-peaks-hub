import '../api/testUtils.ts';
import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import Model3d from './Model3d.svelte';
import { models } from '../lib/model3d.svelte.ts';
import { router } from '../lib/router.svelte.ts';

const PROJECT = '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21';
const FILE = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const DECK = '3c7f1b2e-9a4d-4c6b-8e1f-2a3b4c5d6e7f';
const COMPONENT = '66666666-6666-4666-8666-666666666666';

function fileRow(owner: { deck_id?: string | null; component_id?: string | null }) {
  return {
    id: FILE,
    project_id: PROJECT,
    folder_id: null,
    deck_id: null,
    component_id: null,
    component_role: null,
    filename: 'ace.png',
    content_type: 'image/png',
    byte_size: 4096,
    image_width: 100,
    image_height: 140,
    name_locked: false,
    deleted_at: null,
    uploaded_by: 'someone',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...owner,
  };
}

function serve(row: ReturnType<typeof fileRow>): void {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(
      typeof input === 'string' ? input : (input as Request).url,
      'http://localhost'
    );
    if (url.pathname === `/api/files/${FILE}`) return jsonResponse(200, row);
    if (url.pathname === `/api/projects/${PROJECT}`) {
      return jsonResponse(200, {
        id: PROJECT,
        name: 'Colori',
        description: null,
        role: 'editor',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      });
    }
    // Nobody has dialled this image in, which is the studio's normal opening.
    if (url.pathname === `/api/models/${FILE}`) return jsonResponse(404, { error: 'no settings' });
    return jsonResponse(404, { error: `unrouted ${url.pathname}` });
  });
}

// This screen is one card of one deck. The two branches below are what keeps it
// from quietly becoming a dial-in for images that belong somewhere else --
// reachable, both of them, by a bookmark or a bundle from before the sections.
describe('3D studio addressed by file', () => {
  beforeEach(() => {
    models.reset();
    fetchMock.mockReset();
    router.navigate('/');
  });

  it('sends a component’s artwork to the component’s own screen', async () => {
    serve(fileRow({ component_id: COMPONENT }));

    render(Model3d, { projectId: PROJECT, fileId: FILE });

    await waitFor(() => expect(router.path).toBe(`/projects/${PROJECT}/components/${COMPONENT}`));
  });

  it('says so for an image that is in no deck at all, rather than dialling it in', async () => {
    serve(fileRow({}));

    render(Model3d, { projectId: PROJECT, fileId: FILE });

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a card in a deck/u);
    expect(router.path).toBe('/');
  });

  it('opens on a card that is in a deck', async () => {
    serve(fileRow({ deck_id: DECK }));

    render(Model3d, { projectId: PROJECT, fileId: FILE });

    await screen.findByRole('heading', { name: 'ace.png' });
    expect(router.path).toBe('/');
  });
});
