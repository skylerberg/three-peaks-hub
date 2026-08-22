import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import {
  assertDeckAccess,
  assertImportAccess,
  assertImportRunAccess,
} from '../services/authorization.ts';
import {
  abandonRun,
  bindImport,
  finishRun,
  importPage,
  readBinding,
  readRunDetail,
  readTimeline,
  startRun,
  unbindImport,
} from '../services/deckImport.ts';
import { publishAfterCommit } from '../services/realtime/index.ts';
import { jsonValidator, queryValidator } from '../middleware/validators.ts';
import { AppError } from '../utils/errors.ts';
import {
  conflictErrorResponse,
  forbiddenErrorResponse,
  internalServerErrorResponse,
  notFoundErrorResponse,
  payloadTooLargeErrorResponse,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from '../schemas/errors.ts';
import {
  deckImportSchema,
  importPageQuerySchema,
  importPageResultSchema,
  importRunDetailSchema,
  importRunListSchema,
  importRunSchema,
  putDeckImportRequestSchema,
  startImportRunRequestSchema,
  startedImportRunSchema,
} from '../schemas/imports.ts';
import type { AppHono } from '../types/index.ts';

// Its own router rather than more of routes/decks.ts: that file is the deck a
// person edits by hand, and this one is what an export does to it.
export const deckImportsRouter: AppHono = new Hono();

const standardErrors = {
  ...unauthorizedErrorResponse,
  ...notFoundErrorResponse,
  ...internalServerErrorResponse,
};

const writeErrors = {
  ...conflictErrorResponse,
  ...forbiddenErrorResponse,
  ...standardErrors,
};

deckImportsRouter.put(
  '/:deckId/import',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Bind a deck to a folder of imported artwork',
    description:
      'Idempotent: re-binding to the same folder only updates the label. Re-binding to a different one while the import still has cards in the old folder is refused.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The binding, as it now stands',
        content: { 'application/json': { schema: resolver(deckImportSchema) } },
      },
      201: {
        description: 'Bound',
        content: { 'application/json': { schema: resolver(deckImportSchema) } },
      },
      ...validationErrorResponse,
      ...writeErrors,
    },
  }),
  jsonValidator(putDeckImportRequestSchema),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertDeckAccess(c, deckId, 'write');
    const body = c.req.valid('json') as {
      folder_id: string;
      source_kind?: 'zip';
      source_label?: string | null;
    };

    const { binding, created } = await bindImport(c, deckId, access.projectId, {
      folderId: body.folder_id,
      sourceKind: body.source_kind ?? 'zip',
      sourceLabel: body.source_label ?? null,
    });

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_updated', {
      project_id: access.projectId,
      deck_id: deckId,
    });
    return created ? c.json(binding, 201) : c.json(binding);
  }
);

deckImportsRouter.get(
  '/:deckId/import',
  describeRoute({
    tags: ['Deck imports'],
    summary: "Read a deck's import binding",
    description:
      'A null folder is a binding with nowhere to put images — unbound by hand, or purged out from under it. The cards and the run history are still there either way.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The binding',
        content: { 'application/json': { schema: resolver(deckImportSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const deckId = c.req.param('deckId');
    await assertImportAccess(c, deckId, 'read');
    return c.json(await readBinding(c, deckId));
  }
);

deckImportsRouter.delete(
  '/:deckId/import',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Stop syncing a deck with its export',
    description:
      'The images, the cards and the run history all stay. Re-binding the same folder resumes where this left off.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Unbound' },
      ...writeErrors,
    },
  }),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertImportAccess(c, deckId, 'write');
    await unbindImport(c, access);

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'deck_updated', {
      project_id: access.projectId,
      deck_id: deckId,
    });
    return c.body(null, 204);
  }
);

deckImportsRouter.post(
  '/:deckId/import/runs',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Start an import run',
    description:
      'Takes the whole export up front — every page number and title — and answers with the plan it computed: which pages land on cards that already exist, which are new, and which cards the export has stopped having, by name. Nothing is matched again while the pages upload. One run at a time per deck; a second answers 409 and names the open one, which is the only route back to abandoning it.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Started, with the plan',
        content: { 'application/json': { schema: resolver(startedImportRunSchema) } },
      },
      ...validationErrorResponse,
      ...writeErrors,
    },
  }),
  jsonValidator(startImportRunRequestSchema),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertImportAccess(c, deckId, 'write');
    const body = c.req.valid('json') as {
      id?: string;
      source_label?: string | null;
      pages: { page_number: number; title?: string }[];
    };

    const run = await startRun(c, access, {
      id: body.id,
      sourceLabel: body.source_label ?? null,
      pages: body.pages.map((page) => ({
        pageNumber: page.page_number,
        title: page.title ?? null,
      })),
    });
    return c.json(run, 201);
  }
);

deckImportsRouter.get(
  '/:deckId/import/runs',
  describeRoute({
    tags: ['Deck imports'],
    summary: "Read a deck's import history",
    description: 'Newest first. Counts are derived from each run’s own rows rather than cached.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The runs',
        content: { 'application/json': { schema: resolver(importRunListSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const deckId = c.req.param('deckId');
    const access = await assertImportAccess(c, deckId, 'read');
    return c.json({ runs: await readTimeline(c, access.importId) });
  }
);

deckImportsRouter.post(
  '/import/runs/:runId/pages',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Import one page of an export',
    description:
      'The request body is the page image itself and its metadata travels in the query string, the way the upload route does it. The page has to be one the run planned; its title names the file and decides nothing else. Posting the same page twice answers 200 with what happened the first time.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The page, already imported',
        content: { 'application/json': { schema: resolver(importPageResultSchema) } },
      },
      201: {
        description: 'Imported',
        content: { 'application/json': { schema: resolver(importPageResultSchema) } },
      },
      ...payloadTooLargeErrorResponse,
      ...validationErrorResponse,
      ...writeErrors,
    },
  }),
  queryValidator(importPageQuerySchema),
  async (c) => {
    const runId = c.req.param('runId');
    const access = await assertImportRunAccess(c, runId, 'write');
    const query = c.req.valid('query') as { page_number: string; title?: string };

    const body = c.req.raw.body;
    if (!body) throw new AppError(400, 'Request body is required');

    const { result, created } = await importPage(c, access, {
      pageNumber: Number(query.page_number),
      title: query.title ?? null,
      body: Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
      declaredContentType: c.req.header('content-type') ?? 'application/octet-stream',
      declaredLength: Number(c.req.header('content-length') ?? 0),
    });
    return created ? c.json(result, 201) : c.json(result);
  }
);

deckImportsRouter.post(
  '/import/runs/:runId/finish',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Finish an import run',
    description:
      'The only destructive step: it applies the identities the plan decided, tombstones every card no page was planned onto, and hands the deck what it created. Refuses until every page the run declared has landed, and refuses with 422 if a hand edit has pushed the deck past its card cap while the run was open.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Finished',
        content: { 'application/json': { schema: resolver(importRunDetailSchema) } },
      },
      // Takes no body, and still answers 422: the card-cap backstop runs here.
      // Undeclared, the generated client types the status as never.
      ...validationErrorResponse,
      ...writeErrors,
    },
  }),
  async (c) => {
    const runId = c.req.param('runId');
    const access = await assertImportRunAccess(c, runId, 'write');
    return c.json(await finishRun(c, access));
  }
);

deckImportsRouter.post(
  '/import/runs/:runId/abandon',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Abandon an import run',
    description:
      'Leaves everything already imported in place. Nothing is tombstoned, nothing is undone, and the deck is not touched.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Abandoned',
        content: { 'application/json': { schema: resolver(importRunSchema) } },
      },
      ...writeErrors,
    },
  }),
  async (c) => {
    const runId = c.req.param('runId');
    const access = await assertImportRunAccess(c, runId, 'write');
    return c.json(await abandonRun(c, access));
  }
);

deckImportsRouter.get(
  '/import/runs/:runId',
  describeRoute({
    tags: ['Deck imports'],
    summary: 'Read one import run',
    description:
      'The run and a row per card it touched. A row whose image has since been purged keeps the name and the page number it had.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The run',
        content: { 'application/json': { schema: resolver(importRunDetailSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const runId = c.req.param('runId');
    await assertImportRunAccess(c, runId, 'read');
    return c.json(await readRunDetail(c, runId));
  }
);
