import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    // RESTRICT, not CASCADE: an account cannot be deleted while it still owns a
    // project, so ownership has to move or the project has to go first. Every
    // other FK in this schema cascades.
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('restrict')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('project_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createIndex('project_created_by_idx')
    .on('project')
    .column('created_by')
    .execute();

  await db.schema
    .createTable('project_member')
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('role', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('project_member_pkey', ['project_id', 'user_id'])
    .execute();

  // Answers "which projects can this user see" for the membership half of that
  // question; the creator half is covered by project_created_by_idx above.
  await db.schema
    .createIndex('project_member_user_id_idx')
    .on('project_member')
    .column('user_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('project_member').execute();
  await db.schema.dropTable('project').execute();
}
