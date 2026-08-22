import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_DECK_CARDS, cardPreset } from '@three-peaks/shared';
import { createUser, deleteUser, type TestUser } from '../setup/testContext.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

const poker = cardPreset('poker')!;

describe('decks', () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let projectId: string;
  let cardA: string;
  let cardB: string;
  let backId: string;
  let foreignFileId: string;

  async function uploadTo(user: TestUser, project: string, filename: string) {
    const query = new URLSearchParams({ project_id: project, filename });
    const res = await user.api.postBytes(
      `/api/files/upload?${query}`,
      PNG as unknown as BodyInit,
      'image/png'
    );
    return (await res.json()).id as string;
  }

  async function createDeck(name: string, extra: Record<string, unknown> = {}) {
    const res = await owner.api.post('/api/decks', {
      project_id: projectId,
      name,
      card_width_mm: poker.width_mm,
      card_height_mm: poker.height_mm,
      ...extra,
    });
    return { status: res.status, body: await res.json() };
  }

  beforeAll(async () => {
    [owner, viewer, stranger] = await Promise.all([
      createUser('deck-owner'),
      createUser('deck-viewer'),
      createUser('deck-stranger'),
    ]);

    projectId = (await (await owner.api.post('/api/projects', { name: 'Deck project' })).json()).id;
    await owner.api.put(`/api/projects/${projectId}/members`, {
      email: viewer.email,
      role: 'viewer',
    });

    [cardA, cardB, backId] = await Promise.all([
      uploadTo(owner, projectId, 'card-a.png'),
      uploadTo(owner, projectId, 'card-b.png'),
      uploadTo(owner, projectId, 'back.png'),
    ]);

    const foreignProject = (
      await (await stranger.api.post('/api/projects', { name: 'Elsewhere' })).json()
    ).id;
    foreignFileId = await uploadTo(stranger, foreignProject, 'foreign.png');
  });

  afterAll(async () => {
    for (const user of [owner, viewer, stranger]) await deleteUser(user);
  });

  it('creates a deck and lists it with its counts', async () => {
    const created = await createDeck('Base game');
    expect(created.status).toBe(201);
    expect(created.body.card_width_mm).toBe(63);
    expect(created.body.card_height_mm).toBe(88);
    expect(created.body.card_count).toBe(0);
    expect(created.body.total_copies).toBe(0);

    const listed = await (await owner.api.get(`/api/decks?project_id=${projectId}`)).json();
    expect(listed.decks.map((deck: { name: string }) => deck.name)).toContain('Base game');
  });

  it('refuses a second deck with the same name in one project', async () => {
    await createDeck('Promos');
    expect((await createDeck('Promos')).status).toBe(409);
  });

  it('refuses a second deck with the same name in a different case', async () => {
    await createDeck('Expansion');
    expect((await createDeck('EXPANSION')).status).toBe(409);
  });

  it('refuses a card size the studio could not offer', async () => {
    expect((await createDeck('Enormous', { card_width_mm: 5000 })).status).toBe(422);
  });

  it('refuses a card back from another project', async () => {
    const res = await createDeck('Foreign back', { back_file_id: foreignFileId });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/same project/);
  });

  describe('cards', () => {
    let deckId: string;

    beforeAll(async () => {
      deckId = (await createDeck('Card list', { back_file_id: backId })).body.id;
    });

    it('replaces the whole list, numbering positions from the array', async () => {
      const res = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [
          { file_id: cardA, quantity: 3 },
          { file_id: cardB, quantity: 1 },
        ],
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.cards.map((card: { position: number }) => card.position)).toEqual([0, 1]);
      expect(body.cards[0].file_id).toBe(cardA);
      expect(body.cards[0].quantity).toBe(3);
      // The whole file row rides along, so the editor draws a thumbnail and
      // warns about resolution without a second request.
      expect(body.cards[0].file.filename).toBe('card-a.png');
      expect(body.deck.card_count).toBe(2);
      expect(body.deck.total_copies).toBe(4);
    });

    it('reorders by rewriting the list rather than moving one row', async () => {
      await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [
          { file_id: cardB, quantity: 1 },
          { file_id: cardA, quantity: 3 },
        ],
      });
      const body = await (await owner.api.get(`/api/decks/${deckId}`)).json();
      expect(body.cards.map((card: { file_id: string }) => card.file_id)).toEqual([cardB, cardA]);
    });

    it('empties a deck', async () => {
      const res = await owner.api.put(`/api/decks/${deckId}/cards`, { cards: [] });
      expect((await res.json()).cards).toEqual([]);
    });

    it('refuses the same card twice, because that is a quantity', async () => {
      const res = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [
          { file_id: cardA, quantity: 1 },
          { file_id: cardA, quantity: 1 },
        ],
      });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/only appear in a deck once/);
    });

    it('refuses a card from another project', async () => {
      const res = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [{ file_id: foreignFileId, quantity: 1 }],
      });
      expect(res.status).toBe(422);
    });

    it.each([0, 1000, 1.5])('refuses a quantity of %s', async (quantity) => {
      const res = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [{ file_id: cardA, quantity }],
      });
      expect(res.status).toBe(422);
    });

    it('refuses a list longer than the cap', async () => {
      const res = await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: Array.from({ length: MAX_DECK_CARDS + 1 }, () => ({
          file_id: cardA,
          quantity: 1,
        })),
      });
      expect(res.status).toBe(422);
    });

    it('moves the deck timestamp when only its contents change', async () => {
      const before = (await (await owner.api.get(`/api/decks/${deckId}`)).json()).deck.updated_at;
      await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [{ file_id: cardA, quantity: 2 }],
      });
      const after = (await (await owner.api.get(`/api/decks/${deckId}`)).json()).deck.updated_at;
      expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  describe('a card whose image goes away', () => {
    let deckId: string;
    let doomed: string;

    beforeAll(async () => {
      doomed = await uploadTo(owner, projectId, 'doomed.png');
      deckId = (await createDeck('Fragile')).body.id;
      await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [{ file_id: doomed, quantity: 1 }],
      });
    });

    // A tombstone is what someone deciding whether to restore it reads first,
    // and a deck that silently dropped the card would not show it at all.
    it('keeps a deleted image in the deck, marked as deleted', async () => {
      await owner.api.delete(`/api/files/${doomed}`);
      const body = await (await owner.api.get(`/api/decks/${deckId}`)).json();
      expect(body.cards).toHaveLength(1);
      expect(body.cards[0].file.deleted_at).not.toBeNull();
    });

    it('drops it once the bytes are purged', async () => {
      await owner.api.delete(`/api/files/${doomed}?purge=true`);
      const body = await (await owner.api.get(`/api/decks/${deckId}`)).json();
      expect(body.cards).toEqual([]);
    });
  });

  describe('a back image that is purged', () => {
    it('leaves the deck standing with no back', async () => {
      const orphanBack = await uploadTo(owner, projectId, 'orphan-back.png');
      const deckId = (await createDeck('Loses its back', { back_file_id: orphanBack })).body.id;

      await owner.api.delete(`/api/files/${orphanBack}?purge=true`);

      const res = await owner.api.get(`/api/decks/${deckId}`);
      expect(res.status).toBe(200);
      expect((await res.json()).deck.back_file_id).toBeNull();
    });
  });

  describe('deleting a deck', () => {
    it('takes its cards and leaves the images alone', async () => {
      const deckId = (await createDeck('Temporary')).body.id;
      await owner.api.put(`/api/decks/${deckId}/cards`, {
        cards: [{ file_id: cardA, quantity: 1 }],
      });

      expect((await owner.api.delete(`/api/decks/${deckId}`)).status).toBe(204);
      expect((await owner.api.get(`/api/decks/${deckId}`)).status).toBe(404);
      // Unlike a file, there is no tombstone to find and nothing to purge.
      expect((await owner.api.get(`/api/files/${cardA}`)).status).toBe(200);
    });
  });

  describe('authorization', () => {
    let deckId: string;

    beforeAll(async () => {
      deckId = (await createDeck('Guarded')).body.id;
    });

    it('lets a viewer read a deck', async () => {
      expect((await viewer.api.get(`/api/decks/${deckId}`)).status).toBe(200);
    });

    it.each([
      ['renaming', (user: TestUser) => user.api.patch(`/api/decks/${deckId}`, { name: 'Nope' })],
      ['deleting', (user: TestUser) => user.api.delete(`/api/decks/${deckId}`)],
      [
        'editing the cards',
        (user: TestUser) => user.api.put(`/api/decks/${deckId}/cards`, { cards: [] }),
      ],
    ])('refuses a viewer %s with 403', async (_name, act) => {
      expect((await act(viewer)).status).toBe(403);
    });

    it('refuses a viewer creating a deck with 403', async () => {
      const res = await viewer.api.post('/api/decks', {
        project_id: projectId,
        name: 'Viewer deck',
        card_width_mm: poker.width_mm,
        card_height_mm: poker.height_mm,
      });
      expect(res.status).toBe(403);
    });

    // 403 would tell an outsider the deck exists.
    it('sees 404, not 403, for someone with no access at all', async () => {
      expect((await stranger.api.get(`/api/decks/${deckId}`)).status).toBe(404);
      expect((await stranger.api.delete(`/api/decks/${deckId}`)).status).toBe(404);
    });

    it('hides another project’s decks from its listing', async () => {
      expect((await stranger.api.get(`/api/decks?project_id=${projectId}`)).status).toBe(404);
    });
  });
});
