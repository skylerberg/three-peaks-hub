import { type Kysely, sql } from 'kysely';

// Gives every file exactly one home. A deck owns its cards, a component owns
// its source images, and a file naming neither is a loose asset in the folder
// tree -- which is what the explorer is left showing.
//
// Rollout notes, since old and new pods serve side by side:
//
//  * `component` is new, and the three columns added to `file` are nullable
//    with no default. Every insert of a file names its columns and every select
//    names the ones it wants, so a widened row reaches no reader that would be
//    surprised by it, and the previous release simply leaves all three null.
//  * The CHECK constraints all pass on a row with three nulls, so nothing the
//    previous release writes starts failing.
//  * `file.folder_id` is deliberately left populated on the rows this claims.
//    Nulling it is the one edit the previous release cannot survive -- its
//    explorer reads exactly that column -- so the new release lists assets by
//    `deck_id is null and component_id is null` instead. The two releases then
//    disagree about what they show and never about what they can serve. A
//    follow-up release clears it and adds the CHECK that pins the invariant,
//    the way a renamed column is dropped a release later.
//  * The four asset name indexes are narrowed, which only ever ADMITS more
//    rows: what each rejects afterwards is a strict subset of what it rejected
//    before. The dangerous direction is the reverse of this one.
//  * `component_model` rows are read, never deleted. The previous release's 3D
//    studio still reads them for its dial-in; the same follow-up drops the ones
//    whose settings now live on a component.
//
// `pnpm --filter @three-peaks/api run verify:backfill` runs the backfill below
// against rows shaped like the ones a project held before this, on a scratch
// database. It is what to point at a restored dump before the real run.
//
// The asymmetry that is real: an import running on a pod of the previous
// release writes its artwork into the bound folder without a deck_id, so those
// pages land in Assets rather than in the deck. It resolves by moving them.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('component')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    // Denormalised out of the settings blob rather than read from it: a section
    // lists one kind, and `settings->>'kind'` is not something an index leads
    // with. A CHECK below pins the two together.
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    // The whole dial-in, validated on the way in by ArkType. It lives here
    // rather than beside the file the way component_model's does, because a
    // punchboard's settings describe two files and so cannot be keyed on one.
    .addColumn('settings', 'jsonb', (col) => col.notNull())
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('deleted_by', 'uuid', (col) => col.references('app_user.id').onDelete('set null'))
    .addCheckConstraint('component_name_not_empty', sql`char_length(name) > 0`)
    .addCheckConstraint('component_kind_known', sql`kind in ('wood', 'box', 'board', 'punchboard')`)
    .addCheckConstraint('component_kind_matches_settings', sql`settings->>'kind' = kind`)
    .execute();

  await db.schema
    .createIndex('component_project_kind_idx')
    .on('component')
    .columns(['project_id', 'kind'])
    .execute();

  // Case-folded and predicated on the tombstone, like every other name in the
  // project: a deleted component's name is free again the moment it is deleted.
  await sql`
    create unique index component_unique_name_in_project
      on component (project_id, lower(name))
      where deleted_at is null
  `.execute(db);

  // One statement, so the ACCESS EXCLUSIVE on file is taken once and the CHECKs
  // are validated in the same scan as the columns they are about.
  await sql`
    alter table file
      add column deck_id uuid references deck(id) on delete cascade,
      add column component_id uuid references component(id) on delete cascade,
      add column component_role text,
      add constraint file_one_home check (deck_id is null or component_id is null),
      add constraint file_component_role_paired
        check ((component_id is null) = (component_role is null)),
      add constraint file_component_role_known
        check (component_role is null or component_role in ('artwork', 'cut'))
  `.execute(db);

  // A deck owns bytes now, so deleting one stops being the irreversible act it
  // could afford to be while it held none.
  await db.schema
    .alterTable('deck')
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('deleted_by', 'uuid', (col) => col.references('app_user.id').onDelete('set null'))
    .execute();

  // DISTINCT ON rather than an aggregate: a file in two decks is ordinary today
  // and impossible afterwards, so one of them has to win and the lowest id is
  // the one that does not depend on which row the planner reached first.
  await sql`
    update file set deck_id = owner.deck_id
    from (
      select distinct on (deck_card.file_id) deck_card.file_id, deck_card.deck_id
      from deck_card
      order by deck_card.file_id, deck_card.deck_id
    ) owner
    where file.id = owner.file_id
  `.execute(db);

  // A back image that is already some deck's card stays that deck's: it is in a
  // list, and a back is a pointer. The deck goes on naming it either way.
  await sql`
    update file set deck_id = owner.deck_id
    from (
      select distinct on (deck.back_file_id) deck.back_file_id as file_id, deck.id as deck_id
      from deck
      where deck.back_file_id is not null
      order by deck.back_file_id, deck.id
    ) owner
    where file.id = owner.file_id and file.deck_id is null
  `.execute(db);

  // Names were unique per folder and are about to be unique per deck, and a
  // deck can hold cards that came from two folders. Renaming the later ones is
  // what stops the index below from refusing to build on real data.
  await sql`
    update file
      set filename = left(dup.stem, 200) || ' (' || dup.seq || ')' || dup.ext
    from (
      select
        id,
        regexp_replace(filename, '\\.[^.]+$', '') as stem,
        coalesce(substring(filename from '\\.[^.]+$'), '') as ext,
        row_number() over (
          partition by deck_id, lower(filename) order by created_at, id
        ) as seq
      from file
      where deck_id is not null and deleted_at is null
    ) dup
    where file.id = dup.id and dup.seq > 1
  `.execute(db);

  // Every dial-in that is not a card becomes a component someone can find in a
  // section, keeping the id its settings row had -- which is what lets the
  // update below name it without a mapping table.
  await sql`
    insert into component (
      id, project_id, kind, name, settings, created_by, created_at, updated_at
    )
    select
      candidate.id,
      candidate.project_id,
      candidate.kind,
      case
        when candidate.seq = 1 then candidate.base
        else candidate.base || ' (' || candidate.seq || ')'
      end,
      candidate.settings,
      candidate.updated_by,
      candidate.created_at,
      candidate.updated_at
    from (
      select
        component_model.id,
        component_model.project_id,
        component_model.settings->>'kind' as kind,
        component_model.settings,
        component_model.updated_by,
        component_model.created_at,
        component_model.updated_at,
        stem.base,
        row_number() over (
          partition by component_model.project_id, lower(stem.base)
          order by component_model.created_at, component_model.id
        ) as seq
      from component_model
      join file on file.id = component_model.source_file_id
      cross join lateral (
        select left(
          coalesce(nullif(regexp_replace(file.filename, '\\.[^.]+$', ''), ''), file.filename),
          110
        ) as base
      ) stem
      where component_model.settings->>'kind' <> 'card'
        and file.deck_id is null
    ) candidate
  `.execute(db);

  await sql`
    update file
      set component_id = component_model.id, component_role = 'artwork'
    from component_model
    where component_model.source_file_id = file.id
      and component_model.settings->>'kind' <> 'card'
      and file.deck_id is null
  `.execute(db);

  await db.schema.createIndex('file_deck_idx').on('file').column('deck_id').execute();
  await db.schema.createIndex('file_component_idx').on('file').column('component_id').execute();

  await sql`
    create unique index file_unique_name_in_deck
      on file (deck_id, lower(filename))
      where deck_id is not null and deleted_at is null
  `.execute(db);
  await sql`
    create unique index file_unique_name_in_component
      on file (component_id, lower(filename))
      where component_id is not null and deleted_at is null
  `.execute(db);
  // At most one artwork and one cut sheet per component. A tombstoned file goes
  // on holding its role, or restoring it would land beside a replacement.
  await sql`
    create unique index file_unique_component_role
      on file (component_id, component_role)
      where component_id is not null
  `.execute(db);

  // The asset name indexes stop reaching rows that have left the folder tree,
  // so a card and an asset may share a name once the follow-up clears
  // file.folder_id and they no longer sit in one directory at all.
  await sql`drop index file_unique_name_in_folder`.execute(db);
  await sql`
    create unique index file_unique_name_in_folder
      on file (project_id, folder_id, lower(filename))
      where folder_id is not null and deleted_at is null
        and deck_id is null and component_id is null
  `.execute(db);

  await sql`drop index file_unique_name_at_root`.execute(db);
  await sql`
    create unique index file_unique_name_at_root
      on file (project_id, lower(filename))
      where folder_id is null and deleted_at is null
        and deck_id is null and component_id is null
  `.execute(db);

  await sql`drop index deck_unique_name_in_project`.execute(db);
  await sql`
    create unique index deck_unique_name_in_project
      on deck (project_id, lower(name))
      where deleted_at is null
  `.execute(db);
}

// A development affordance rather than a rollout mechanism, like 0006's: the
// name indexes it puts back refuse to build on a database holding a tombstone
// that shares a name with a live row.
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index deck_unique_name_in_project`.execute(db);
  await sql`
    create unique index deck_unique_name_in_project
      on deck (project_id, lower(name))
  `.execute(db);

  await sql`drop index file_unique_name_at_root`.execute(db);
  await sql`
    create unique index file_unique_name_at_root
      on file (project_id, lower(filename))
      where folder_id is null and deleted_at is null
  `.execute(db);

  await sql`drop index file_unique_name_in_folder`.execute(db);
  await sql`
    create unique index file_unique_name_in_folder
      on file (project_id, folder_id, lower(filename))
      where folder_id is not null and deleted_at is null
  `.execute(db);

  await db.schema
    .alterTable('file')
    .dropColumn('deck_id')
    .dropColumn('component_id')
    .dropColumn('component_role')
    .execute();
  await db.schema.alterTable('deck').dropColumn('deleted_at').dropColumn('deleted_by').execute();
  await db.schema.dropTable('component').execute();
}
