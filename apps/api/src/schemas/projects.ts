import { type } from 'arktype';
import { PROJECT_ROLES } from '@three-peaks/shared';
import { optionalText, stringWithLength, uuid } from './common.ts';

const roleSchema = type.enumerated(...PROJECT_ROLES);

export const createProjectRequestSchema = type({
  'id?': uuid,
  name: stringWithLength(1, 120),
  'description?': optionalText(2000),
});

export const updateProjectRequestSchema = type({
  'name?': stringWithLength(1, 120),
  'description?': optionalText(2000),
});

export const projectSchema = type({
  id: 'string',
  name: 'string',
  description: 'string | null',
  created_by: 'string',
  created_at: 'string',
  updated_at: 'string',
  // The caller's own role, so the client never has to derive it.
  role: roleSchema,
});

export const projectListSchema = type({ projects: projectSchema.array() });

export const projectMemberSchema = type({
  user_id: 'string',
  email: 'string',
  name: 'string',
  role: roleSchema,
  // True for the creator, who is an implicit editor and has no member row.
  is_creator: 'boolean',
});

export const projectMemberListSchema = type({ members: projectMemberSchema.array() });

export const putProjectMemberRequestSchema = type({ email: 'string.email', role: roleSchema });
