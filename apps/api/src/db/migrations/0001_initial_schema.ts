import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_user')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    // Rotated by change-password and reset-password. It is the reset token's
    // HMAC subject, which is what makes a mailed link single-use — and it has
    // nothing to do with sessions, which those flows deliberately leave alone.
    .addColumn('alternative_id', 'uuid', (col) => col.notNull().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('email_verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('app_user_email_not_empty', sql`char_length(email) > 0`)
    .addCheckConstraint('app_user_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  // Addresses are compared case-insensitively, so uniqueness has to be too.
  await db.schema
    .createIndex('app_user_email_lower_unique')
    .unique()
    .on('app_user')
    .expression(sql`lower(email)`)
    .execute();

  await db.schema
    .createTable('session')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    // The token itself is never stored. A database dump is not a set of live
    // credentials.
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('user_agent', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  await db.schema.createIndex('session_user_id_idx').on('session').column('user_id').execute();

  await db.schema
    .createTable('personal_access_token')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz')
    .addCheckConstraint('personal_access_token_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createIndex('personal_access_token_user_id_idx')
    .on('personal_access_token')
    .column('user_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('personal_access_token').execute();
  await db.schema.dropTable('session').execute();
  await db.schema.dropTable('app_user').execute();
}
