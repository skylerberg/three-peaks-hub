import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { MAX_DECK_CARDS, cardPreset } from '@three-peaks/shared';
import { db } from '../../src/db/index.ts';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const poker = cardPreset('poker')!;

// A file has one home, and moving between them is the only way it changes.
// These are the rules the sections rest on: Assets shows what belongs to
// nothing, and a deck or a component holds the rest.
describe('where a file lives', () => {
  let owner: TestUser;
  let projectId: string;

  beforeAll(async () => {
    owner = await createUser('homes-owner');
    projectId = (await (await owner.api.post('/api/projects', { name: 'Homes' })).json()).id;
  });

  afterAll(async () => {
    await deleteUser(owner);
  });

  async function upload(filename: string, into: Record<string, string> = {}) {
    const query = new URLSearchParams({ project_id: projectId, filename, ...into });
    const res = await owner.api.postBytes(
      `/api/files/upload?${query}`,
      PNG as unknown as BodyInit,
      'image/png'
    );
    return { status: res.status, body: await res.json() };
  }

  async function makeDeck(name: string): Promise<string> {
    const res = await owner.api.post('/api/decks', {
      project_id: projectId,
      name,
      card_width_mm: poker.width_mm,
      card_height_mm: poker.height_mm,
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  async function makeFolder(name: string): Promise<string> {
    const res = await owner.api.post('/api/files/folders', { project_id: projectId, name });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  async function makeComponent(name: string, kind = 'wood'): Promise<string> {
    const res = await owner.api.post('/api/components', { project_id: projectId, kind, name });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  async function assetIds(folderId?: string): Promise<string[]> {
    const query = folderId ? `&folder_id=${folderId}` : '';
    const res = await owner.api.get(`/api/files/directory?project_id=${projectId}${query}`);
    expect(res.status).toBe(200);
    return ((await res.json()).files as { id: string }[]).map((file) => file.id);
  }

  function move(fileId: string, to: Record<string, unknown>) {
    return owner.api.post(`/api/files/${fileId}/move`, to);
  }

  it('carries a card out of a deck into Assets and back', async () => {
    const deckId = await makeDeck('Travelling');
    const file = (await upload('traveller.png', { deck_id: deckId })).body.id as string;
    expect(await assetIds()).not.toContain(file);

    expect((await move(file, { folder_id: null })).status).toBe(200);
    expect(await assetIds()).toContain(file);
    // Out of the arrangement too: a deck's cards are exactly its own images.
    expect((await (await owner.api.get(`/api/decks/${deckId}`)).json()).cards).toEqual([]);

    expect((await move(file, { deck_id: deckId })).status).toBe(200);
    expect(await assetIds()).not.toContain(file);
    const back = await (await owner.api.get(`/api/decks/${deckId}`)).json();
    expect(back.cards.map((card: { file_id: string }) => card.file_id)).toEqual([file]);
  });

  // The Assets root has no folder to leave behind, so the case that matters is
  // a file sitting in one: an owner and a folder on the same row is what the
  // exclusivity CHECK refuses, and this is the write that would produce it.
  it('leaves the folder behind when a file moves out of Assets into a deck', async () => {
    const deckId = await makeDeck('Takes from a folder');
    const folderId = await makeFolder('Reference');
    const file = (await upload('sketch.png', { folder_id: folderId })).body.id as string;

    expect((await move(file, { deck_id: deckId })).status).toBe(200);

    const row = await (await owner.api.get(`/api/files/${file}`)).json();
    expect(row.deck_id).toBe(deckId);
    expect(row.folder_id).toBeNull();
  });

  it('renames on arrival rather than refusing a clash it cannot see', async () => {
    const deckId = await makeDeck('Name clash');
    expect((await upload('same.png', { deck_id: deckId })).status).toBe(201);
    const loose = (await upload('same.png')).body.id as string;

    const res = await move(loose, { deck_id: deckId });
    expect(res.status).toBe(200);
    expect((await res.json()).filename).toBe('same (2).png');
  });

  it('refuses two homes at once', async () => {
    const deckId = await makeDeck('Two homes');
    const componentId = await makeComponent('Two homes piece');
    const file = (await upload('ambiguous.png')).body.id as string;

    const res = await move(file, { deck_id: deckId, component_id: componentId });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/one home/);
  });

  it('refuses a folder move through the rename route once a deck owns it', async () => {
    const deckId = await makeDeck('Not by patch');
    const file = (await upload('owned.png', { deck_id: deckId })).body.id as string;

    const res = await owner.api.patch(`/api/files/${file}`, { folder_id: null });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Move it instead/);
  });

  it('refuses to move a card out of a deleted deck until the deck is back', async () => {
    const deckId = await makeDeck('Frozen');
    const file = (await upload('frozen.png', { deck_id: deckId })).body.id as string;
    expect((await owner.api.delete(`/api/decks/${deckId}`)).status).toBe(204);

    const res = await move(file, { folder_id: null });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Frozen/);

    expect((await owner.api.post(`/api/decks/${deckId}/restore`)).status).toBe(200);
    expect((await move(file, { folder_id: null })).status).toBe(200);
  });

  it('moves a component’s artwork to Assets and leaves the role behind', async () => {
    const componentId = await makeComponent('Sheds its artwork');
    const file = (await upload('shed.png', { component_id: componentId })).body.id as string;

    expect((await move(file, { folder_id: null })).status).toBe(200);
    const row = await (await owner.api.get(`/api/files/${file}`)).json();
    expect(row.component_id).toBeNull();
    expect(row.component_role).toBeNull();

    const component = await (await owner.api.get(`/api/components/${componentId}`)).json();
    expect(component.files).toEqual([]);
    expect(component.missing_roles).toEqual(['artwork']);
  });

  it('refuses a move into a component slot that is already filled', async () => {
    const componentId = await makeComponent('Already has artwork');
    expect((await upload('taken.png', { component_id: componentId })).status).toBe(201);
    const loose = (await upload('spare.png')).body.id as string;

    const res = await move(loose, { component_id: componentId, role: 'artwork' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already has one of those/);
  });

  // Both ways in consult assertRoomForCard, where what the cap protects is
  // written down.
  describe('a deck already holding as many cards as a deck holds', () => {
    let filler = 0;

    // Rows rather than uploads: what this measures is the number of cards, and
    // five hundred uploads measure the same thing far more slowly.
    async function fillDeck(deckId: string, count: number): Promise<void> {
      const rows = Array.from({ length: count }, () => {
        filler += 1;
        return { id: randomUUID(), filename: `filler-${filler}.png`, position: filler };
      });

      await db
        .insertInto('file')
        .values(
          rows.map((row) => ({
            id: row.id,
            project_id: projectId,
            deck_id: deckId,
            filename: row.filename,
            storage_key: randomUUID(),
            content_type: 'image/png',
            byte_size: '0',
            uploaded_by: owner.id,
          }))
        )
        .execute();

      await db
        .insertInto('deck_card')
        .values(
          rows.map((row) => ({
            id: randomUUID(),
            deck_id: deckId,
            file_id: row.id,
            quantity: 1,
            position: row.position,
          }))
        )
        .execute();
    }

    it('refuses an upload of one more card, before the bytes go up', async () => {
      const deckId = await makeDeck('Full deck');
      await fillDeck(deckId, MAX_DECK_CARDS);

      const res = await upload('one-too-many.png', { deck_id: deckId });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/as many as a deck holds/);
    });

    it('refuses a move in, and takes a back either way', async () => {
      const deckId = await makeDeck('Full deck, moved into');
      await fillDeck(deckId, MAX_DECK_CARDS);
      const loose = (await upload('from-assets.png')).body.id as string;

      const refused = await move(loose, { deck_id: deckId });
      expect(refused.status).toBe(422);
      expect((await refused.json()).error).toMatch(/as many as a deck holds/);

      // A back is a pointer rather than a card, so the cap has nothing to say
      // about it.
      expect((await move(loose, { deck_id: deckId, role: 'back' })).status).toBe(200);
    });
  });

  it('says where a deleted file came from, and what stands in its way', async () => {
    const deckId = await makeDeck('Deleted from');
    const file = (await upload('binned.png', { deck_id: deckId })).body.id as string;
    expect((await owner.api.delete(`/api/files/${file}`)).status).toBe(204);

    const listing = await (
      await owner.api.get(`/api/files/deleted?project_id=${projectId}`)
    ).json();
    const entry = listing.entries.find((row: { id: string }) => row.id === file);
    expect(entry).toMatchObject({ home_kind: 'deck', path: 'Deleted from', blocked_by: null });

    // And once the deck itself is gone, it is the deck that has to come back.
    expect((await owner.api.delete(`/api/decks/${deckId}`)).status).toBe(204);
    const after = await (await owner.api.get(`/api/files/deleted?project_id=${projectId}`)).json();
    expect(after.entries.find((row: { id: string }) => row.id === file).blocked_by).toBe(
      'Deleted from'
    );
    // The deck is an entry of its own, not a path above something else.
    expect(after.entries.find((row: { id: string }) => row.id === deckId)).toMatchObject({
      kind: 'deck',
      path: '',
    });
  });
});
