import { fetchMock, jsonResponse } from '../api/testUtils.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { projects } from './projects.svelte.ts';

function serve(status: number): void {
  // A Response body reads once, so each call gets its own.
  fetchMock.mockImplementation(async () =>
    status === 200 ? jsonResponse(200, { projects: [] }) : jsonResponse(status, { error: 'Boom' })
  );
}

describe('ProjectStore.ensureLoaded', () => {
  beforeEach(() => {
    projects.reset();
    fetchMock.mockReset();
  });

  it('asks the server once even when the screen asks again', async () => {
    serve(200);

    await projects.ensureLoaded();
    await projects.ensureLoaded();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The attempt is latched whether it worked or not: the screen used to re-ask
  // on the strength of the failure itself, which is a request per frame.
  it('does not ask again after the attempt failed', async () => {
    serve(500);

    await expect(projects.ensureLoaded()).rejects.toThrow();
    await expect(projects.ensureLoaded()).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again when the visitor retries', async () => {
    serve(500);
    await expect(projects.ensureLoaded()).rejects.toThrow();

    serve(200);
    await projects.reload();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks again for the next account after a reset', async () => {
    serve(200);
    await projects.ensureLoaded();

    projects.reset();
    await projects.ensureLoaded();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
