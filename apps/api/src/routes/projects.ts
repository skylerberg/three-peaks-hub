import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { normalizeProjectRole } from '@three-peaks/shared';
import {
  assertProjectAccess,
  assertProjectOwner,
  assertProjectWrite,
} from '../services/authorization.ts';
import { deleteStoredObjectsAfterCommit } from '../services/storage/index.ts';
import { publishAfterCommit } from '../services/realtime/index.ts';
import { jsonValidator } from '../middleware/validators.ts';
import { AppError, isUniqueViolation } from '../utils/errors.ts';
import { newId } from '../utils/uuid.ts';
import {
  createProjectRequestSchema,
  projectListSchema,
  projectMemberListSchema,
  projectSchema,
  putProjectMemberRequestSchema,
  updateProjectRequestSchema,
} from '../schemas/projects.ts';
import {
  conflictErrorResponse,
  forbiddenErrorResponse,
  internalServerErrorResponse,
  notFoundErrorResponse,
  unauthorizedErrorResponse,
  validationErrorResponse,
} from '../schemas/errors.ts';
import type { AppHono } from '../types/index.ts';

export const projectsRouter: AppHono = new Hono();

const standardErrors = {
  ...unauthorizedErrorResponse,
  ...notFoundErrorResponse,
  ...internalServerErrorResponse,
};

function serialize(row: {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  role: string;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_by: row.created_by,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    role: normalizeProjectRole(row.role),
  };
}

projectsRouter.get(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'List projects',
    description: 'Every project the caller created or is a member of, with their role on each.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Projects',
        content: { 'application/json': { schema: resolver(projectListSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const user = c.get('user');
    // One query, not one per project: the creator's implicit editor role is
    // computed in SQL rather than by reading the membership table separately.
    const rows = await c
      .get('db')
      .selectFrom('project as p')
      .leftJoin('project_member as m', (join) =>
        join.onRef('m.project_id', '=', 'p.id').on('m.user_id', '=', user.id)
      )
      .select((eb) => [
        'p.id as id',
        'p.name as name',
        'p.description as description',
        'p.created_by as created_by',
        'p.created_at as created_at',
        'p.updated_at as updated_at',
        eb
          .case()
          .when('p.created_by', '=', user.id)
          .then('editor')
          .else(eb.ref('m.role'))
          .end()
          .as('role'),
      ])
      .where((eb) => eb.or([eb('p.created_by', '=', user.id), eb('m.user_id', 'is not', null)]))
      .orderBy('p.updated_at', 'desc')
      .execute();

    return c.json({
      projects: rows.map((row) => serialize({ ...row, role: row.role ?? 'viewer' })),
    });
  }
);

projectsRouter.post(
  '/',
  describeRoute({
    tags: ['Projects'],
    summary: 'Create a project',
    description: 'The creator is an implicit editor and is never stored as a member row.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: resolver(projectSchema) } },
      },
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(createProjectRequestSchema),
  async (c) => {
    const body = c.req.valid('json') as { id?: string; name: string; description?: string | null };
    const user = c.get('user');

    try {
      const row = await c
        .get('db')
        .insertInto('project')
        .values({
          id: body.id ?? newId(),
          name: body.name,
          description: body.description ?? null,
          created_by: user.id,
        })
        .returning(['id', 'name', 'description', 'created_by', 'created_at', 'updated_at'])
        .executeTakeFirstOrThrow();

      return c.json(serialize({ ...row, role: 'editor' }), 201);
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError(409, 'A project with that id exists');
      throw error;
    }
  }
);

projectsRouter.get(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Get a project',
    description: 'Answers 404 rather than 403 for a project the caller cannot see.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'The project',
        content: { 'application/json': { schema: resolver(projectSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertProjectAccess(c, id);
    const row = await c
      .get('db')
      .selectFrom('project')
      .select([
        'project.id as id',
        'project.name as name',
        'project.description as description',
        'project.created_by as created_by',
        'project.created_at as created_at',
        'project.updated_at as updated_at',
      ])
      .where('project.id', '=', id)
      .executeTakeFirstOrThrow();

    return c.json(serialize({ ...row, role: access.role }));
  }
);

projectsRouter.patch(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Update a project',
    description: 'Editors only. A viewer who can read the project gets 403.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated',
        content: { 'application/json': { schema: resolver(projectSchema) } },
      },
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(updateProjectRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const access = await assertProjectWrite(c, id);
    const body = c.req.valid('json') as { name?: string; description?: string | null };

    const row = await c
      .get('db')
      .updateTable('project')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        updated_at: new Date(),
      })
      .where('project.id', '=', id)
      .returning(['id', 'name', 'description', 'created_by', 'created_at', 'updated_at'])
      .executeTakeFirstOrThrow();

    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'project_updated', {
      project_id: id,
    });
    return c.json(serialize({ ...row, role: access.role }));
  }
);

projectsRouter.delete(
  '/:id',
  describeRoute({
    tags: ['Projects'],
    summary: 'Delete a project',
    description: 'Owner only. Cascades to members, folders and file rows.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Deleted' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    await assertProjectOwner(c, id);

    const db = c.get('db');
    // Locked first: appendFileVersion takes the same row lock, so an append
    // cannot commit in the window between the keys being collected and the
    // cascade, which would leave its object named by nothing. In id order, the
    // one order every bulk file lock in the repo takes -- a purge's and an
    // import's overlap with this one whenever a deck lives in the project.
    await db
      .selectFrom('file')
      .select(['file.id as id'])
      .where('file.project_id', '=', id)
      .forUpdate()
      .orderBy('file.id')
      .execute();

    // Collect the storage keys before the cascade removes the rows naming them,
    // then delete the objects after commit.
    const files = await db
      .selectFrom('file')
      // Left, so a file with no version rows of its own still contributes the
      // key its mirror names.
      .leftJoin('file_version', 'file_version.file_id', 'file.id')
      .select([
        'file.storage_key as storage_key',
        'file_version.storage_key as version_storage_key',
      ])
      .where('file.project_id', '=', id)
      .execute();

    await db.deleteFrom('project').where('project.id', '=', id).execute();

    const keys = new Set<string>();
    for (const file of files) {
      keys.add(file.storage_key);
      if (file.version_storage_key !== null) keys.add(file.version_storage_key);
    }

    deleteStoredObjectsAfterCommit(c.get('postCommitHooks'), [...keys]);
    publishAfterCommit(c.get('postCommitHooks'), c.get('user').id, 'project_deleted', {
      project_id: id,
    });

    return c.body(null, 204);
  }
);

projectsRouter.get(
  '/:id/members',
  describeRoute({
    tags: ['Projects'],
    summary: 'List members',
    description: 'The creator is listed first and is always an editor.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Members',
        content: { 'application/json': { schema: resolver(projectMemberListSchema) } },
      },
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    await assertProjectAccess(c, id);
    const db = c.get('db');

    const creator = await db
      .selectFrom('project as p')
      .innerJoin('app_user as u', 'u.id', 'p.created_by')
      .select(['u.id as user_id', 'u.email as email', 'u.name as name'])
      .where('p.id', '=', id)
      .executeTakeFirstOrThrow();

    const members = await db
      .selectFrom('project_member as m')
      .innerJoin('app_user as u', 'u.id', 'm.user_id')
      .select(['u.id as user_id', 'u.email as email', 'u.name as name', 'm.role as role'])
      .where('m.project_id', '=', id)
      .orderBy('u.name', 'asc')
      .execute();

    return c.json({
      members: [
        { ...creator, role: 'editor' as const, is_creator: true },
        ...members.map((member) => ({
          user_id: member.user_id,
          email: member.email,
          name: member.name,
          role: normalizeProjectRole(member.role),
          is_creator: false,
        })),
      ],
    });
  }
);

projectsRouter.put(
  '/:id/members',
  describeRoute({
    tags: ['Projects'],
    summary: 'Add or change a member',
    description: 'Owner only. The creator cannot be added as a member of their own project.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Member set' },
      ...conflictErrorResponse,
      ...forbiddenErrorResponse,
      ...validationErrorResponse,
      ...standardErrors,
    },
  }),
  jsonValidator(putProjectMemberRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    await assertProjectOwner(c, id);
    const body = c.req.valid('json') as { email: string; role: 'editor' | 'viewer' };
    const db = c.get('db');
    const user = c.get('user');

    const target = await db
      .selectFrom('app_user')
      .select(['app_user.id as id'])
      .where((eb) => eb(eb.fn('lower', ['app_user.email']), '=', body.email.toLowerCase()))
      .executeTakeFirst();

    if (!target) throw new AppError(404, 'No account with that email');

    const project = await db
      .selectFrom('project')
      .select(['project.created_by as created_by'])
      .where('project.id', '=', id)
      .executeTakeFirstOrThrow();

    // The creator's editor role is implicit. A member row for them would be a
    // second, contradictable source of truth.
    if (project.created_by === target.id) {
      throw new AppError(409, 'The project owner is already an editor');
    }

    await db
      .insertInto('project_member')
      .values({ project_id: id, user_id: target.id, role: body.role })
      .onConflict((oc) => oc.columns(['project_id', 'user_id']).doUpdateSet({ role: body.role }))
      .execute();

    publishAfterCommit(c.get('postCommitHooks'), user.id, 'members_changed', { project_id: id });
    return c.body(null, 204);
  }
);

projectsRouter.delete(
  '/:id/members/:userId',
  describeRoute({
    tags: ['Projects'],
    summary: 'Remove a member',
    description: 'The owner may remove anyone; a member may remove only themselves.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Removed' },
      ...forbiddenErrorResponse,
      ...standardErrors,
    },
  }),
  async (c) => {
    const id = c.req.param('id');
    const targetUserId = c.req.param('userId');
    // Access, not write: a viewer may use this to remove themselves and nothing
    // else, which the check below is what enforces.
    const access = await assertProjectAccess(c, id);
    const user = c.get('user');

    if (!access.isCreator && targetUserId !== user.id) {
      throw new AppError(403, 'Only the project owner can remove other members');
    }

    await c
      .get('db')
      .deleteFrom('project_member')
      .where('project_member.project_id', '=', id)
      .where('project_member.user_id', '=', targetUserId)
      .execute();

    publishAfterCommit(c.get('postCommitHooks'), user.id, 'members_changed', { project_id: id });
    return c.body(null, 204);
  }
);
