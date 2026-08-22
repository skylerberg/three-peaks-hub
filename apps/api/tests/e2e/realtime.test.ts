import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/index.ts';
import { attachRealtime } from '../../src/services/realtime/index.ts';
import { resetConnectionsForTests } from '../../src/services/realtime/state.ts';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

// Drives a real socket against a real server, because the interesting parts --
// the handshake deadline, the per-event access re-check, delivery to the right
// sockets -- are all transport behaviour that an in-process request cannot
// reach.
describe('realtime over a websocket', () => {
  let server: ReturnType<typeof serve>;
  let detach: () => void;
  let port: number;
  let owner: TestUser;
  let member: TestUser;
  let stranger: TestUser;
  let projectId: string;

  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    detach = attachRealtime(server as unknown as Server);
    port = (server.address() as { port: number }).port;

    [owner, member, stranger] = await Promise.all([
      createUser('rt-owner'),
      createUser('rt-member'),
      createUser('rt-stranger'),
    ]);

    projectId = (await (await owner.api.post('/api/projects', { name: 'Realtime' })).json()).id;
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: member.email,
      role: 'viewer',
    });
  });

  afterAll(async () => {
    detach();
    resetConnectionsForTests();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const user of [owner, member, stranger]) await deleteUser(user);
  });

  function connect(token: string | null, project = projectId) {
    return new Promise<{ socket: WebSocket; events: Record<string, unknown>[] }>(
      (resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const events: Record<string, unknown>[] = [];

        socket.on('open', () => {
          if (token) socket.send(JSON.stringify({ type: 'auth', token }));
        });
        socket.on('message', (raw) => {
          const frame = JSON.parse(String(raw));
          if (frame.type === 'ready') {
            socket.send(JSON.stringify({ type: 'subscribe', project_id: project }));
            // Resolve after the subscribe has been read, so a publish that
            // follows cannot land before the room exists.
            setTimeout(() => resolve({ socket, events }), 50);
            return;
          }
          events.push(frame);
        });
        socket.on('error', reject);
        if (!token) setTimeout(() => resolve({ socket, events }), 50);
      }
    );
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

  it('delivers a mutation to a subscribed member', async () => {
    const { socket, events } = await connect(owner.token);

    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Announced' });
    await settle();

    expect(events.map((event) => event.type)).toContain('folder_created');
    const created = events.find((event) => event.type === 'folder_created')!;
    expect(created.project_id).toBe(projectId);
    // Every event names who caused it, so a client can ignore its own echo.
    expect(created.actor_user_id).toBe(owner.id);

    socket.close();
  });

  it('delivers to a viewer as well as the owner', async () => {
    const [a, b] = await Promise.all([connect(owner.token), connect(member.token)]);

    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Shared' });
    await settle();

    expect(a.events.some((event) => event.type === 'folder_created')).toBe(true);
    expect(b.events.some((event) => event.type === 'folder_created')).toBe(true);

    a.socket.close();
    b.socket.close();
  });

  // Subscribing is not authorization. A socket may name any project id; what
  // decides delivery is the access check run per event.
  it('delivers nothing to someone who subscribed to a project they cannot read', async () => {
    const { socket, events } = await connect(stranger.token);

    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Private' });
    await settle();

    expect(events).toEqual([]);
    socket.close();
  });

  it('stops delivering once membership is removed', async () => {
    const { socket, events } = await connect(member.token);

    await owner.api.delete(`/api/projects/${projectId}/members/${member.id}`);
    await settle();
    events.length = 0;

    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'After Removal' });
    await settle();

    // The socket is still open and still subscribed; the access re-check is
    // what closes the gap, so removal takes effect without a reconnect.
    expect(events).toEqual([]);
    socket.close();

    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: member.email,
      role: 'viewer',
    });
  });

  // The screen showing a file's history has to follow someone else appending to
  // it. Identical bytes create no version, so there is nothing to announce and
  // announcing anyway would send every open history screen back to the API for
  // a list that has not moved.
  it('announces a new version, and stays quiet when identical bytes create none', async () => {
    const { socket, events } = await connect(owner.token);

    const created = await owner.api.postBytes(
      `/api/files/upload?project_id=${projectId}&filename=versioned.txt`,
      'the bytes it was uploaded with' as unknown as BodyInit
    );
    expect(created.status).toBe(201);
    const fileId = (await created.json()).id;
    await settle();
    events.length = 0;

    expect(
      (await owner.api.postBytes(`/api/files/${fileId}/versions`, 'bytes that are new')).status
    ).toBe(201);
    await settle();

    const announced = events.find((event) => event.type === 'file_version_created');
    expect(announced).toBeDefined();
    expect(announced!.project_id).toBe(projectId);
    expect(announced!.file_id).toBe(fileId);
    expect(announced!.actor_user_id).toBe(owner.id);
    events.length = 0;

    expect(
      (await owner.api.postBytes(`/api/files/${fileId}/versions`, 'bytes that are new')).status
    ).toBe(200);
    await settle();
    expect(events.map((event) => event.type)).not.toContain('file_version_created');

    socket.close();
  });

  it('closes a socket that never presents a credential', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const code = await new Promise<number>((resolve) => {
      socket.on('close', resolve);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'auth', token: 'nonsense' })));
    });
    expect(code).toBe(4401);
  });

  // The bus carries { type, payload }; the wire frame is { type, ...payload },
  // which is what packages/shared's generated union describes. Without this,
  // the two shapes can drift and the only symptom is a client reading undefined
  // off every event.
  it('sends a flat frame whose fields match the published document', async () => {
    const { socket, events } = await connect(owner.token);

    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Wire Shape' });
    await settle();

    const event = events.find((entry) => entry.type === 'folder_created')!;
    expect(event).toBeDefined();
    expect(event).not.toHaveProperty('payload');

    const { realtimeEventsDocument } = await import('../../src/services/realtime/document.ts');
    const declared = realtimeEventsDocument().events.folder_created.payload;
    expect(Object.keys(event).sort()).toEqual([...declared, 'type'].sort());

    socket.close();
  });

  it('ignores a subscribe naming something that is not a uuid', async () => {
    const { socket, events } = await connect(owner.token);
    socket.send(JSON.stringify({ type: 'subscribe', project_id: '../../etc/passwd' }));
    await settle();

    await owner.api.post('/api/files/folders', { project_id: projectId, name: 'Still Fine' });
    await settle();

    // The bad room is ignored and the good one still works.
    expect(events.some((event) => event.type === 'folder_created')).toBe(true);
    socket.close();
  });
});
