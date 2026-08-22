import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import {
  assertDeckAccess,
  assertFilesInProject,
  assertProjectAccess,
  assertProjectWrite,
} from '../services/authorization.ts';
import { publishAfterCommit } from '../services/realtime/index.ts';
import { jsonValidator, queryValidator } from '../middleware/validators.ts';
import { AppError, isUniqueViolation } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import { projectQuerySchema } from '../schemas/common.ts';
import {
  createDeckRequestSchema,
  deckListSchema,
  deckSchema,
  deckWithCardsSchema,
  putDeckCardsRequestSchema,
  updateDeckRequestSchema,
} from '../schemas/decks.ts';
import {
  conflictErrorResponse,
  forbiddenErrorResponse,
  internalServerErrorResponse,
  notFoundErrorResponse,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from '../schemas/errors.ts';
import type { AppContext, AppHono, Connection } from '../types/index.ts';

export const decksRouter: AppHono = new Hono();

const standardErrors = {
  ...unauthorizedErrorResponse,
  ...notFoundErrorResponse,
  ...internalServerErrorResponse,
};

interface DeckRow {
  id: string;
  project_id: string;
  name: string;
  // numeric comes back from pg as a string, the way bigint does.
  card_width_mm: string | number;
  card_height_mm: string | number;
  back_file_id: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  card_count: string | number | null;
  total_copies: string | number | null;
}

const DECK_COLUMNS = [
  'deck.id as id',
  'deck.project_id as project_id',
  'deck.name as name',
  'deck.card_width_mm as card_width_mm',
  'deck.card_height_mm as card_height_mm',
  'deck.back_file_id as back_file_id',
  'deck.created_by as created_by',
  'deck.created_at as created_at',
  'deck.updated_at as updated_at',
] as const;

function serializeDeck(row: DeckRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    card_width_mm: Number(row.card_width_mm),
    card_height_mm: Number(row.card_height_mm),
    back_file_id: row.back_file_id,
    created_by: row.created_by,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    card_count: Number(row.card_count ?? 0),
    total_copies: Number(row.total_copies ?? 0),
  };
}

// The two totals every deck is listed with, as a correlated subquery each rather
// than a join: a join to deck_card would multiply the deck rows and both numbers
// would then have to be undone with a group by.
function withCounts(db: Connection) {
  return db.selectFrom('deck').select((eb) => [
    ...DECK_COLUMNS,
    eb
      .selectFrom('deck_card')
      .whereRef('deck_card.deck_id', '=', 'deck.id')
      .select((inner) => inner.fn.countAll<string>().as('count'))
      .as('card_count'),
    eb
      .selectFrom('deck_card')
      .whereRef('deck_card.deck_id', '=', 'deck.id')
      .select((inner) => inner.fn.sum<string>('deck_card.quantity').as('total'))
      .as('total_copies'),
  ]);
}

async function readDeck(c: Pick<AppContext, 'get'>, deckId: string) {
  const row = await withCounts(c.get('db')).where('deck.id', '=', deckId).executeTakeFirst();
  if (!row) throw new AppError(404, 'Deck not found');
  return serializeDeck(row);
}

async function readDeckCards(c: Pick<AppContext, 'get'>, deckId: string) {
  const rows = await c
    .get('db')
    .selectFrom('deck_card')
    .innerJoin('file', 'file.id', 'deck_card.file_id')
    .select([
      'deck_card.file_id as file_id',
      'deck_card.quantity as quantity',
      'deck_card.position as position',
      'file.id as f_id',
      'file.project_id as f_project_id',
      'file.folder_id as f_folder_id',
      'file.filename as f_filename',
      'file.content_type as f_content_type',
      'file.byte_size as f_byte_size',
      'file.image_width as f_image_width',
      'file.image_height as f_image_height',
      'file.uploaded_by as f_uploaded_by',
      'file.created_at as f_created_at',
      'file.updated_at as f_updated_at',
      'file.deleted_at as f_deleted_at',
    ])
    .where('deck_card.deck_id', '=', deckId)
    // id breaks the tie, so a listing is stable rather than whatever order the
    // planner happened to return equal positions in.
    .orderBy('deck_card.position', 'asc')
    .orderBy('deck_card.id', 'asc')
    .execute();

  return rows.map((row) => ({
    file_id: row.file_id,
    quantity: row.quantity,
    position: row.position,
    file: {
      id: row.f_id,
      project_id: row.f_project_id,
      folder_id: row.f_folder_id,
      filename: row.f_filename,
      content_type: row.f_content_type,
      byte_size: Number(row.f_byte_size),
      image_width: row.f_image_width,
      image_height: row.f_image_height,
      uploaded_by: row.f_uploaded_by,
      created_at: new Date(row.f_created_at).toISOString(),
      updated_at: new Date(row.f_updated_at).toISOString(),
      deleted_at: row.f_deleted_at === null ? null : new Date(row.f_deleted_at).toISOString(),
    },
  }));
}

decksRouter.get(
  '/',
  describeRoute({
    tags: ['Decks'],
    summary: 'List the decks in a project',
    description:
      'Each deck carries how many distinct cards it holds and how many pieces of card those add up to, so the screen needs no follow-up request per deck. The cards themselves come from the single-deck route.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Decks',
        content: { 'application/json': { schema: resolver(deckListSchema) } },
      },
      ...standardErrors,
    },
  }),
  queryValidator(projectQuerySchema),
  async (c) => {
    const { project_id: projectId } = c.req.valid('query') as { project_id: string };
    await assertProjectAccess(c, projectId);

    const rows = await withCounts(c.get('db'))
      .where('deck.project_id', '=', projectId)
      .orderBy('deck.name', 'asc')
      .execute();

    return c.json({ decks: rows.map(serializeDeck) });
  }
);

decksRouter.post(
  '/',
  describeRoute({
    tags: ['Decks'],
    summary: 'Create a deck',
    description: 'Starts empty. Cards are added with the card-list route.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(deckSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(createDeckRequestSchema),
  async (c) => {
    const body = c.req.valid('json') as {
      id?: string;
      project_id: string;
      name: string;
      card_width_mm: number;
      card_height_mm: number;
      back_file_id?: string | null;
    };
    await assertProjectWrite(c, body.project_id);

    const backFileId = body.back_file_id ?? null;
    if (backFileId !== null) {
      await assertFilesInProject(c, [backFileId], body.project_id, 'The card back');
    }

    const id = body.id ?? newId();
    try {
      await c
        .get('db')
        .insertInto('deck')
        .values({
          id,
          project_id: body.project_id,
          name: body.name,
          card_width_mm: body.card_width_mm,
          card_height_mm: body.card_height_mm,
          back_file_id: backFileId,
          created_by: c.get('user').id,
        })
        .execute();
    } catch (error) {
      // Covers both unique indexes: the client-supplied id and the deck name.
      // A pre-check on either is two statements with a gap between them.
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A deck with that id or name already exists in this project');
      }
      throw error;
    }

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_created', {
      project_id: body.project_id,
      deck_id: id,
    });
    return c.json(await readDeck(c, id), 201);
  }
);

decksRouter.get(
  '/:deckId',
  describeRoute({
    tags: ['Decks'],
    summary: 'Get a deck and its cards',
    description:
      'Cards come back in print order, each with the whole file row behind it. A card whose image has been deleted is still listed — restoring the image puts it back in the run.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The deck',
        content: { 'application/json': { schema: resolver(deckWithCardsSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const deckId = c.req.param('deckId');
    await assertDeckAccess(c, deckId, 'read');
    const [deck, cards] = await Promise.all([readDeck(c, deckId), readDeckCards(c, deckId)]);
    return c.json({ deck, cards });
  }
);

decksRouter.patch(
  '/:deckId',
  describeRoute({
    tags: ['Decks'],
    summary: 'Update a deck',
    description: 'Editors only. Every field is optional; an absent one is left alone.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: resolver(deckSchema) } },
      },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(updateDeckRequestSchema),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertDeckAccess(c, deckId, 'write');
    const body = c.req.valid('json') as {
      name?: string;
      card_width_mm?: number;
      card_height_mm?: number;
      back_file_id?: string | null;
    };

    if (body.back_file_id !== undefined && body.back_file_id !== null) {
      await assertFilesInProject(c, [body.back_file_id], access.projectId, 'The card back');
    }

    const patch = {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.card_width_mm !== undefined && { card_width_mm: body.card_width_mm }),
      ...(body.card_height_mm !== undefined && { card_height_mm: body.card_height_mm }),
      ...(body.back_file_id !== undefined && { back_file_id: body.back_file_id }),
      updated_at: new Date(),
    };

    try {
      await c.get('db').updateTable('deck').set(patch).where('deck.id', '=', deckId).execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(409, 'A deck with that name already exists in this project');
      }
      throw error;
    }

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_updated', {
      project_id: access.projectId,
      deck_id: deckId,
    });
    return c.json(await readDeck(c, deckId));
  }
);

decksRouter.delete(
  '/:deckId',
  describeRoute({
    tags: ['Decks'],
    summary: 'Delete a deck',
    description:
      'Editors only, and unlike a file this is not recoverable — a deck stores no bytes, so there is nothing for a tombstone to protect and no purge to reclaim. The images it named are untouched.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Deleted' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertDeckAccess(c, deckId, 'write');

    await c.get('db').deleteFrom('deck').where('deck.id', '=', deckId).execute();

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_deleted', {
      project_id: access.projectId,
      deck_id: deckId,
    });
    return c.body(null, 204);
  }
);

decksRouter.put(
  '/:deckId/cards',
  describeRoute({
    tags: ['Decks'],
    summary: 'Replace a deck’s cards',
    description:
      'The whole ordered list in one request. Position is the array index, so adding, removing and reordering are the same call and none of them can interleave with another.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The deck as it now stands',
        content: { 'application/json': { schema: resolver(deckWithCardsSchema) } },
      },
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(putDeckCardsRequestSchema),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertDeckAccess(c, deckId, 'write');
    const { cards } = c.req.valid('json') as { cards: { file_id: string; quantity: number }[] };

    const fileIds = cards.map((entry) => entry.file_id);
    // Caught here rather than left to the unique constraint: the same image
    // twice is a client that meant to raise a quantity, and "already in the
    // deck" says so where a 409 on a constraint name would not.
    if (new Set(fileIds).size !== fileIds.length) {
      throw new AppError(422, 'A card can only appear in a deck once — raise its quantity instead');
    }
    await assertFilesInProject(c, fileIds, access.projectId, 'Every card');

    const db = c.get('db');
    await db.deleteFrom('deck_card').where('deck_card.deck_id', '=', deckId).execute();

    if (cards.length > 0) {
      await db
        .insertInto('deck_card')
        .values(
          cards.map((entry, index) => ({
            id: newId(),
            deck_id: deckId,
            file_id: entry.file_id,
            quantity: entry.quantity,
            position: index,
          }))
        )
        .execute();
    }

    // The deck itself is what a listing sorts and a client caches on, so an
    // edit to its contents has to move its timestamp too.
    await db
      .updateTable('deck')
      .set({ updated_at: new Date() })
      .where('deck.id', '=', deckId)
      .execute();

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_updated', {
      project_id: access.projectId,
      deck_id: deckId,
    });

    const [deck, saved] = await Promise.all([readDeck(c, deckId), readDeckCards(c, deckId)]);
    return c.json({ deck, cards: saved });
  }
);
