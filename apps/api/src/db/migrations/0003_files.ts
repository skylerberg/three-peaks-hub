import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('folder')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    // Null parent is the project root. Self-referencing, so deleting a folder
    // takes its subtree with it.
    .addColumn('parent_id', 'uuid', (col) => col.references('folder.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('folder_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createIndex('folder_project_parent_idx')
    .on('folder')
    .columns(['project_id', 'parent_id'])
    .execute();

  // Two names differing only in case in one directory is a rename trap on
  // case-insensitive clients, so uniqueness folds case. Two partial indexes
  // rather than one, because NULL parent_id never equals itself and a single
  // index would let unlimited duplicates sit at the root.
  await sql`
    create unique index folder_unique_name_in_parent
      on folder (project_id, parent_id, lower(name))
      where parent_id is not null
  `.execute(db);

  await sql`
    create unique index folder_unique_name_at_root
      on folder (project_id, lower(name))
      where parent_id is null
  `.execute(db);

  await db.schema
    .createTable('file')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('folder_id', 'uuid', (col) => col.references('folder.id').onDelete('cascade'))
    .addColumn('filename', 'text', (col) => col.notNull())
    // Server-generated uuid naming the stored object. Never derived from the
    // filename: the filename is user input and the key is a path.
    .addColumn('storage_key', 'uuid', (col) => col.notNull().unique())
    // What the bytes actually are, decided by magic-byte sniffing rather than
    // by what the client declared.
    .addColumn('content_type', 'text', (col) => col.notNull())
    .addColumn('byte_size', 'bigint', (col) => col.notNull())
    .addColumn('checksum', 'text')
    .addColumn('image_width', 'integer')
    .addColumn('image_height', 'integer')
    .addColumn('uploaded_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('file_filename_not_empty', sql`char_length(filename) > 0`)
    .addCheckConstraint('file_byte_size_non_negative', sql`byte_size >= 0`)
    .execute();

  await db.schema
    .createIndex('file_project_folder_idx')
    .on('file')
    .columns(['project_id', 'folder_id'])
    .execute();

  await sql`
    create unique index file_unique_name_in_folder
      on file (project_id, folder_id, lower(filename))
      where folder_id is not null
  `.execute(db);

  await sql`
    create unique index file_unique_name_at_root
      on file (project_id, lower(filename))
      where folder_id is null
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('file').execute();
  await db.schema.dropTable('folder').execute();
}
