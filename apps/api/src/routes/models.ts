import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { ModelSettings } from '@three-peaks/shared';
import { assertFileAccess } from '../services/authorization.ts';
import { publishAfterCommit } from '../services/realtime/index.ts';
import { jsonValidator } from '../middleware/validators.ts';
import { AppError } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import { componentModelSchema, putComponentModelRequestSchema } from '../schemas/models.ts';
import {
  forbiddenErrorResponse,
  internalServerErrorResponse,
  notFoundErrorResponse,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from '../schemas/errors.ts';
import type { AppContext, AppHono } from '../types/index.ts';

export const modelsRouter: AppHono = new Hono();

const standardErrors = {
  ...unauthorizedErrorResponse,
  ...notFoundErrorResponse,
  ...internalServerErrorResponse,
};

function serialize(row: {
  source_file_id: string;
  project_id: string;
  settings: ModelSettings;
  updated_by: string;
  created_at: Date | string;
  updated_at: Date | string;
}) {
  return {
    source_file_id: row.source_file_id,
    project_id: row.project_id,
    settings: row.settings,
    updated_by: row.updated_by,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

// A card's reverse names another file, and nothing else checks it: the id is
// stored, not dereferenced, so a settings row could otherwise point at a
// project the caller cannot see and quietly keep pointing there.
async function assertBackFileInProject(
  c: Pick<AppContext, 'get'>,
  settings: ModelSettings,
  projectId: string
): Promise<void> {
  if (settings.kind !== 'card' || settings.back_file_id === null) return;

  const row = await c
    .get('db')
    .selectFrom('file')
    .select(['file.id as id'])
    .where('file.id', '=', settings.back_file_id)
    .where('file.project_id', '=', projectId)
    .executeTakeFirst();

  if (!row) throw new AppError(422, 'The card back must be a file in the same project');
}

modelsRouter.get(
  '/:fileId',
  describeRoute({
    tags: ['Models'],
    summary: 'Read the 3D settings for an image',
    description:
      'Answers 404 when the image has never been dialled in, which is how the studio knows to start from the defaults.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The saved settings',
        content: { 'application/json': { schema: resolver(componentModelSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const fileId = c.req.param('fileId');
    await assertFileAccess(c, fileId, 'read');

    const row = await c
      .get('db')
      .selectFrom('component_model')
      .select([
        'component_model.source_file_id as source_file_id',
        'component_model.project_id as project_id',
        'component_model.settings as settings',
        'component_model.updated_by as updated_by',
        'component_model.created_at as created_at',
        'component_model.updated_at as updated_at',
      ])
      .where('component_model.source_file_id', '=', fileId)
      .executeTakeFirst();

    if (!row) throw new AppError(404, 'This image has no 3D settings yet');
    return c.json(serialize(row));
  }
);

modelsRouter.put(
  '/:fileId',
  describeRoute({
    tags: ['Models'],
    summary: 'Save the 3D settings for an image',
    description:
      'Editors only. There is one settings row per image, so this upserts rather than conflicting.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Saved',
        content: { 'application/json': { schema: resolver(componentModelSchema) } },
      },
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(putComponentModelRequestSchema),
  async (c) => {
    const fileId = c.req.param('fileId');
    const access = await assertFileAccess(c, fileId, 'write');
    const { settings } = c.req.valid('json') as { settings: ModelSettings };

    await assertBackFileInProject(c, settings, access.projectId);

    const now = new Date();
    const row = await c
      .get('db')
      .insertInto('component_model')
      .values({
        id: newId(),
        project_id: access.projectId,
        source_file_id: fileId,
        settings,
        updated_by: c.get('user').id,
        updated_at: now,
      })
      // One row per image is the whole addressing scheme, so a second save is an
      // update rather than the 409 a client-supplied id would earn.
      .onConflict((oc) =>
        oc.column('source_file_id').doUpdateSet({
          settings,
          updated_by: c.get('user').id,
          updated_at: now,
        })
      )
      .returning([
        'source_file_id',
        'project_id',
        'settings',
        'updated_by',
        'created_at',
        'updated_at',
      ])
      .executeTakeFirstOrThrow();

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'model_updated', {
      project_id: access.projectId,
      file_id: fileId,
    });
    return c.json(serialize(row));
  }
);
