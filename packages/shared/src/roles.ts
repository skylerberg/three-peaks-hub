export const PROJECT_ROLES = ['editor', 'viewer'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

// Fail closed. Anything that is not exactly 'editor' reads as 'viewer', so a
// role that arrives corrupted, renamed or absent narrows access rather than
// widening it.
export function normalizeProjectRole(role: string | null | undefined): ProjectRole {
  return role === 'editor' ? 'editor' : 'viewer';
}

export function canEdit(role: ProjectRole): boolean {
  return role === 'editor';
}
