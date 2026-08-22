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

export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>;

export type Json = JsonValue;

export type JsonArray = JsonValue[];

export type JsonObject = {
  [x: string]: JsonValue | undefined;
};

export type JsonPrimitive = boolean | number | string | null;

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export type Numeric = ColumnType<string, number | string, number | string>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AppUser {
  alternative_id: Generated<string>;
  created_at: Generated<Timestamp>;
  email: string;
  email_verified: Generated<boolean>;
  id: string;
  name: string;
  password_hash: string;
  updated_at: Generated<Timestamp>;
}

export interface ComponentModel {
  created_at: Generated<Timestamp>;
  id: string;
  project_id: string;
  settings: Json;
  source_file_id: string;
  updated_at: Generated<Timestamp>;
  updated_by: string;
}

export interface Deck {
  back_file_id: string | null;
  card_height_mm: Numeric;
  card_width_mm: Numeric;
  created_at: Generated<Timestamp>;
  created_by: string;
  id: string;
  name: string;
  project_id: string;
  updated_at: Generated<Timestamp>;
}

export interface DeckCard {
  deck_id: string;
  file_id: string;
  id: string;
  position: number;
  quantity: Generated<number>;
}

export interface File {
  byte_size: Int8;
  checksum: string | null;
  content_type: string;
  created_at: Generated<Timestamp>;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  filename: string;
  folder_id: string | null;
  id: string;
  image_height: number | null;
  image_width: number | null;
  project_id: string;
  storage_key: string;
  updated_at: Generated<Timestamp>;
  uploaded_by: string;
}

export interface FileVersion {
  byte_size: Int8;
  checksum: string | null;
  content_type: string;
  created_at: Generated<Timestamp>;
  created_by: string;
  file_id: string;
  id: string;
  image_height: number | null;
  image_width: number | null;
  storage_key: string;
  version_number: number;
}

export interface Folder {
  created_at: Generated<Timestamp>;
  created_by: string;
  deleted_at: Timestamp | null;
  deleted_by: string | null;
  id: string;
  name: string;
  parent_id: string | null;
  project_id: string;
  updated_at: Generated<Timestamp>;
}

export interface PersonalAccessToken {
  created_at: Generated<Timestamp>;
  id: string;
  last_used_at: Timestamp | null;
  name: string;
  token_hash: string;
  user_id: string;
}

export interface Project {
  created_at: Generated<Timestamp>;
  created_by: string;
  description: string | null;
  id: string;
  name: string;
  updated_at: Generated<Timestamp>;
}

export interface ProjectMember {
  created_at: Generated<Timestamp>;
  project_id: string;
  role: string;
  user_id: string;
}

export interface Session {
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  id: string;
  token_hash: string;
  user_agent: string | null;
  user_id: string;
}

export interface DB {
  app_user: AppUser;
  component_model: ComponentModel;
  deck: Deck;
  deck_card: DeckCard;
  file: File;
  file_version: FileVersion;
  folder: Folder;
  personal_access_token: PersonalAccessToken;
  project: Project;
  project_member: ProjectMember;
  session: Session;
}
