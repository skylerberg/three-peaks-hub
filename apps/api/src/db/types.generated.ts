// AUTO-GENERATED. DO NOT EDIT.
// Regenerate with: pnpm --filter @three-peaks/api run kysely-codegen
//
// The generator migrates a scratch database from src/db/migrations, introspects
// that, and drops it. It never reads the database you develop against, so a
// column left behind by an abandoned branch cannot land in a commit looking
// exactly like a real one.
import type { ColumnType } from 'kysely';

export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>;

export interface AppUser {
  id: string;
  alternative_id: Generated<string>;
  email: string;
  password_hash: string;
  name: string;
  email_verified: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface Session {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
}

export interface PersonalAccessToken {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  created_at: Generated<Timestamp>;
  last_used_at: Timestamp | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: string;
  created_at: Generated<Timestamp>;
}

export interface Folder {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface File {
  id: string;
  project_id: string;
  folder_id: string | null;
  filename: string;
  storage_key: string;
  content_type: string;
  byte_size: Int8;
  checksum: string | null;
  image_width: number | null;
  image_height: number | null;
  uploaded_by: string;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface DB {
  app_user: AppUser;
  session: Session;
  personal_access_token: PersonalAccessToken;
  project: Project;
  project_member: ProjectMember;
  folder: Folder;
  file: File;
}
