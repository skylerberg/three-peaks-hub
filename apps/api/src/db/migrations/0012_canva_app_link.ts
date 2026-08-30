import { type Kysely, sql } from 'kysely';

// Ties a Canva user to an account here.
//
// The Canva app can prove which Canva user is running it -- a signed token says
// so -- and that is all it can prove. Nobody at Canva knows which account here
// belongs to that person, and no token can say. So somebody signed in here has
// to say it once, and this is where the answer is kept.
//
// A pairing row is the sentence in between: the app asks for one and shows the
// code, and a person signed in here spends it. It is deliberately a separate
// table from the link rather than a nullable column on it, because the two have
// opposite lifetimes -- a pairing is worthless within minutes and a link is
// meant to outlive every session either side of it.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('canva_app_link')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    // Canva scopes a user id to the app that asked, so this string means
    // nothing outside our app and cannot be correlated with anyone else's.
    .addColumn('canva_user_id', 'text', (col) => col.notNull().unique())
    // Kept for the account screen, which has nothing else to tell two links
    // apart by. Not part of any lookup.
    .addColumn('canva_brand_id', 'text')
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_used_at', 'timestamptz')
    .execute();

  // The account screen lists a user's links, and the cascade above deletes by
  // this column when an account goes away.
  await db.schema
    .createIndex('canva_app_link_user_idx')
    .on('canva_app_link')
    .column('user_id')
    .execute();

  await db.schema
    .createTable('canva_app_pairing')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    // Hashed, not stored. It is short enough to be read off a screen and typed,
    // which is exactly what makes it worth not keeping in the clear.
    .addColumn('code_hash', 'text', (col) => col.notNull().unique())
    .addColumn('canva_user_id', 'text', (col) => col.notNull())
    .addColumn('canva_brand_id', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    // Stamped rather than deleted, so spending a code twice is refused by
    // something that can say why instead of by a row that is simply missing.
    .addColumn('claimed_at', 'timestamptz')
    .addColumn('claimed_by', 'uuid', (col) => col.references('app_user.id').onDelete('cascade'))
    .addCheckConstraint(
      'canva_app_pairing_claimed_together',
      sql`(claimed_at is null) = (claimed_by is null)`
    )
    .execute();

  // One live pairing per Canva user: asking again replaces the code rather than
  // leaving a second one valid, so a code read off a screen somebody has walked
  // away from stops working the moment they ask for another.
  await sql`
    create unique index canva_app_pairing_one_live
      on canva_app_pairing (canva_user_id) where claimed_at is null
  `.execute(db);

  await db.schema
    .createIndex('canva_app_pairing_expiry_idx')
    .on('canva_app_pairing')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('canva_app_pairing').execute();
  await db.schema.dropTable('canva_app_link').execute();
}
