import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import Projects from './Projects.svelte';
import { projects } from '../lib/projects.svelte.ts';
import { toasts } from '../lib/toasts.svelte.ts';

const PROJECT = {
  id: '2f1c9e5a-8b3d-4f1e-9c2a-7d6b5e4f3a21',
  name: 'Colori',
  description: null,
  role: 'editor',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Projects screen', () => {
  beforeEach(() => {
    projects.reset();
    toasts.clear();
    fetchMock.mockReset();
  });

  // A failed load left `loaded` false and flipped `loading` back, and the effect
  // that read both re-ran on that write -- so the screen asked again, failed
  // again, and toasted again for as long as it stayed open.
  it('asks once when the list request fails, and says so', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Internal error' }));

    render(Projects);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toasts.toasts).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Internal error');
  });

  it('asks again when the visitor retries, and shows what comes back', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Internal error' }));
    render(Projects);
    await settle();

    fetchMock.mockImplementation(async () => jsonResponse(200, { projects: [PROJECT] }));
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: /Colori/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
