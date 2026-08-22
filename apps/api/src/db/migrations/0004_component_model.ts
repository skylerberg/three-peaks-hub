import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('component_model')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    // One dial-in per source image, so opening the studio on a file is what
    // addresses the row -- there is nothing else to name.
    .addColumn('source_file_id', 'uuid', (col) =>
      col.notNull().unique().references('file.id').onDelete('cascade')
    )
    // The whole settings object, validated on the way in by ArkType rather than
    // spread across columns that every new dial would have to add one of.
    .addColumn('settings', 'jsonb', (col) => col.notNull())
    .addColumn('updated_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('component_model_project_idx')
    .on('component_model')
    .column('project_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('component_model').execute();
}
