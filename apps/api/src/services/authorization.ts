import { type ProjectRole, normalizeProjectRole } from '@three-peaks/shared';
import { AppError } from '../utils/errors.ts';
import type { AppContext } from '../types/index.ts';

export interface ProjectAccess {
  projectId: string;
  role: ProjectRole;
  isCreator: boolean;
}

// The rule this module exists to enforce:
//
//   404 for a caller with no access; 403 only for a caller who can already
//   read the row.
//
// A 403 on a project you cannot see tells you it exists. Every project-scoped
// read goes through assertProjectAccess and every project-scoped mutation
// through assertProjectWrite — a mutating route that asserts only access is a
// defect, not a style choice.
export async function assertProjectAccess(
  c: Pick<AppContext, 'get'>,
  projectId: string
): Promise<ProjectAccess> {
  const db = c.get('db');
  const user = c.get('user');

  const row = await db
    .selectFrom('project as p')
    .leftJoin('project_member as m', (join) =>
      join.onRef('m.project_id', '=', 'p.id').on('m.user_id', '=', user.id)
    )
    .select(['p.id as id', 'p.created_by as created_by', 'm.role as role'])
    .where('p.id', '=', projectId)
    .executeTakeFirst();

  if (!row) throw new AppError(404, 'Project not found');

  // The creator is an implicit editor and is never stored as a member row, so
  // there is no way to demote or remove them by editing membership.
  if (row.created_by === user.id) {
    return { projectId, role: 'editor', isCreator: true };
  }

  if (row.role === null || row.role === undefined) {
    // Visible to nobody else: same answer as a project that does not exist.
    throw new AppError(404, 'Project not found');
  }

  return { projectId, role: normalizeProjectRole(row.role), isCreator: false };
}

export async function assertProjectWrite(
  c: Pick<AppContext, 'get'>,
  projectId: string
): Promise<ProjectAccess> {
  const access = await assertProjectAccess(c, projectId);
  if (access.role !== 'editor') {
    // 403 is correct here and only here: this caller can already read the row.
    throw new AppError(403, 'You do not have permission to modify this project');
  }
  return access;
}

export async function assertProjectOwner(
  c: Pick<AppContext, 'get'>,
  projectId: string
): Promise<ProjectAccess> {
  const access = await assertProjectAccess(c, projectId);
  if (!access.isCreator) {
    throw new AppError(403, 'Only the project owner can do this');
  }
  return access;
}

// Resolves the project a folder belongs to and asserts access in one round
// trip, so a caller never has to read the row before it is allowed to.
export async function assertFolderAccess(
  c: Pick<AppContext, 'get'>,
  folderId: string,
  mode: 'read' | 'write' = 'read'
): Promise<ProjectAccess> {
  const db = c.get('db');
  const row = await db
    .selectFrom('folder')
    .select(['folder.project_id as project_id'])
    .where('folder.id', '=', folderId)
    .executeTakeFirst();

  if (!row) throw new AppError(404, 'Folder not found');
  const access =
    mode === 'write'
      ? await assertProjectWrite(c, row.project_id)
      : await assertProjectAccess(c, row.project_id);
  return access;
}

export async function assertFileAccess(
  c: Pick<AppContext, 'get'>,
  fileId: string,
  mode: 'read' | 'write' = 'read'
): Promise<ProjectAccess> {
  const db = c.get('db');
  const row = await db
    .selectFrom('file')
    .select(['file.project_id as project_id'])
    .where('file.id', '=', fileId)
    .executeTakeFirst();

  if (!row) throw new AppError(404, 'File not found');
  return mode === 'write'
    ? await assertProjectWrite(c, row.project_id)
    : await assertProjectAccess(c, row.project_id);
}
