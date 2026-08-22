import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('file_version')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    // Cascade, not restrict: a pod running the previous release deletes a file
    // with a plain DELETE FROM file and knows nothing about this table. Under
    // restrict that statement starts failing part-way through a rollout.
    .addColumn('file_id', 'uuid', (col) => col.notNull().references('file.id').onDelete('cascade'))
    .addColumn('version_number', 'integer', (col) => col.notNull())
    .addColumn('storage_key', 'uuid', (col) => col.notNull().unique())
    .addColumn('content_type', 'text', (col) => col.notNull())
    .addColumn('byte_size', 'bigint', (col) => col.notNull())
    // Null means unknown rather than empty: the rows backfilled below come from
    // a table that has never had a checksum computed, and reading every object
    // out of the bucket to invent one is not something a migration may do.
    .addColumn('checksum', 'text')
    .addColumn('image_width', 'integer')
    .addColumn('image_height', 'integer')
    // Restrict, unlike the file_id above: an author is not an owner. Cascading
    // here would let deleting one account cut versions out of the middle of
    // other people's files and orphan the objects those rows named, which is
    // the same reason project.created_by restricts.
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('restrict')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Also the index the newest-version lookup scans backward, so there is no
    // second descending index to keep.
    .addUniqueConstraint('file_version_unique_number', ['file_id', 'version_number'])
    .addCheckConstraint('file_version_number_positive', sql`version_number >= 1`)
    .addCheckConstraint('file_version_byte_size_non_negative', sql`byte_size >= 0`)
    .execute();

  await sql`
    insert into file_version (
      id, file_id, version_number, storage_key, content_type, byte_size,
      checksum, image_width, image_height, created_by, created_at
    )
    select
      gen_random_uuid(), f.id, 1, f.storage_key, f.content_type, f.byte_size,
      f.checksum, f.image_width, f.image_height, f.uploaded_by, f.created_at
    from file f
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('file_version').execute();
}
