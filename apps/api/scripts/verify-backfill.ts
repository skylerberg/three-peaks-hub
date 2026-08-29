/**
 * Runs migration 0009's backfill against rows shaped like the ones a project
 * held before it, on a scratch database of its own.
 *
 * Not a `check:*` script and not in the gate: the backfill runs once, against
 * data no test fixture has. What this is for is the hour before that run --
 * point it at a restored dump's shape and see the answers it gives.
 *
 *   pnpm --filter @three-peaks/api run verify:backfill
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { env } from '../src/config/env.ts';

const scratch = 'three_peaks_hub_backfill_probe';

function maintenance() {
  return new pg.Client({
    host: env.db.hostname,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.maintenanceDatabase,
  });
}

const setup = maintenance();
await setup.connect();
await setup.query(`drop database if exists "${scratch}"`);
await setup.query(`create database "${scratch}"`);
await setup.end();

// The CLI has no "migrate to": up goes to the latest and down steps back one.
// So this migrates the whole way, steps 0009 back off, plants rows shaped like
// the ones production holds, and runs 0009 forward over them.
function migrate(direction: 'up' | 'down' = 'up') {
  const result = spawnSync(
    'node',
    ['--import', 'tsx', 'src/db/migrate-cli.ts', ...(direction === 'down' ? ['down'] : [])],
    { stdio: 'inherit', env: { ...process.env, DB_DATABASE: scratch } }
  );
  if (result.status !== 0) throw new Error(`migrate ${direction} failed`);
}

const client = new pg.Client({
  host: env.db.hostname,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: scratch,
});

const problems: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) problems.push(name);
};

try {
  migrate();
  migrate('down');
  await client.connect();

  // A project as it stands before this change: two folders, a deck whose cards
  // and back live in one of them, a wooden component dialled in on a loose
  // image, and two files that share a name in different folders.
  await client.query(`
    insert into app_user (id, email, name, password_hash, email_verified)
      values ('11111111-1111-4111-8111-111111111111', 'probe@example.com', 'Probe', 'x', true);
    insert into project (id, name, created_by)
      values ('22222222-2222-4222-8222-222222222222', 'Legacy', '11111111-1111-4111-8111-111111111111');
    insert into folder (id, project_id, parent_id, name, created_by) values
      ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', null, 'Cards', '11111111-1111-4111-8111-111111111111'),
      ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', null, 'More', '11111111-1111-4111-8111-111111111111');
  `);

  const file = async (id: string, folder: string | null, filename: string) => {
    await client.query(
      `insert into file (id, project_id, folder_id, filename, storage_key, content_type, byte_size, uploaded_by)
       values ($1, '22222222-2222-4222-8222-222222222222', $2, $3, gen_random_uuid(), 'image/png', 10, '11111111-1111-4111-8111-111111111111')`,
      [id, folder, filename]
    );
    await client.query(
      `insert into file_version (id, file_id, version_number, storage_key, content_type, byte_size, created_by)
       values (gen_random_uuid(), $1, 1, gen_random_uuid(), 'image/png', 10, '11111111-1111-4111-8111-111111111111')`,
      [id]
    );
  };

  const CARDS = '33333333-3333-4333-8333-333333333333';
  const MORE = '44444444-4444-4444-8444-444444444444';
  await file('a0000000-0000-4000-8000-000000000001', CARDS, 'alpha.png');
  // Same name, different folder, and both end up cards of one deck: the pair
  // the per-deck name index would refuse without the rename in the backfill.
  await file('a0000000-0000-4000-8000-000000000002', MORE, 'alpha.png');
  await file('a0000000-0000-4000-8000-000000000003', CARDS, 'back.png');
  await file('a0000000-0000-4000-8000-000000000004', null, 'meeple.png');
  await file('a0000000-0000-4000-8000-000000000005', MORE, 'reference.png');
  // A wooden dial-in on a file that is also a card: the deck has to win.
  await file('a0000000-0000-4000-8000-000000000006', CARDS, 'both.png');

  await client.query(`
    insert into deck (id, project_id, name, card_width_mm, card_height_mm, back_file_id, created_by)
      values ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222',
              'Base', 63, 88, 'a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111');
    insert into deck_card (id, deck_id, file_id, quantity, position) values
      (gen_random_uuid(), '55555555-5555-4555-8555-555555555555', 'a0000000-0000-4000-8000-000000000001', 1, 0),
      (gen_random_uuid(), '55555555-5555-4555-8555-555555555555', 'a0000000-0000-4000-8000-000000000002', 1, 1),
      (gen_random_uuid(), '55555555-5555-4555-8555-555555555555', 'a0000000-0000-4000-8000-000000000006', 1, 2);
    insert into component_model (id, project_id, source_file_id, settings, updated_by) values
      (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000004',
       '{"kind":"wood","longest_side_mm":30}', '11111111-1111-4111-8111-111111111111'),
      (gen_random_uuid(), '22222222-2222-4222-8222-222222222222', 'a0000000-0000-4000-8000-000000000006',
       '{"kind":"wood","longest_side_mm":40}', '11111111-1111-4111-8111-111111111111');
  `);
  await client.end();

  migrate();

  const after = new pg.Client({
    host: env.db.hostname,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: scratch,
  });
  await after.connect();

  const rows = (
    await after.query(
      `select id, filename, folder_id, deck_id, component_id, component_role from file order by filename`
    )
  ).rows;
  const byId = new Map(rows.map((row) => [row.id as string, row]));

  const card = byId.get('a0000000-0000-4000-8000-000000000001');
  check(
    'a deck card is owned by its deck',
    card.deck_id === '55555555-5555-4555-8555-555555555555'
  );
  check('its folder is left alone for the previous release', card.folder_id === CARDS);

  const back = byId.get('a0000000-0000-4000-8000-000000000003');
  check(
    'the deck back is owned by its deck',
    back.deck_id === '55555555-5555-4555-8555-555555555555'
  );

  const clash = byId.get('a0000000-0000-4000-8000-000000000002');
  check(
    'two cards that shared a name are renamed apart',
    clash.filename === 'alpha (2).png',
    String(clash.filename)
  );

  const component = (await after.query(`select id, kind, name from component`)).rows;
  check(
    'one component is made, for the dial-in that is not a card',
    component.length === 1,
    JSON.stringify(component)
  );
  check('it takes its kind from the settings', component[0]?.kind === 'wood');
  check('it is named after its file', component[0]?.name === 'meeple', String(component[0]?.name));

  const meeple = byId.get('a0000000-0000-4000-8000-000000000004');
  check('the component owns its artwork', meeple.component_id === component[0]?.id);
  check('in the artwork role', meeple.component_role === 'artwork');

  // The deck wins: a file in a deck's card list is a card, whatever settings
  // somebody once saved against it.
  const both = byId.get('a0000000-0000-4000-8000-000000000006');
  check(
    'a card with a wooden dial-in stays a card',
    both.deck_id !== null && both.component_id === null
  );

  const loose = byId.get('a0000000-0000-4000-8000-000000000005');
  check('an unowned file stays an asset', loose.deck_id === null && loose.component_id === null);

  await after.end();
} finally {
  const teardown = maintenance();
  await teardown.connect();
  await teardown.query(`drop database if exists "${scratch}"`);
  await teardown.end();
}

if (problems.length > 0) {
  console.error(`\n${problems.length} backfill assertion(s) failed`);
  process.exit(1);
}
console.log('\nbackfill probe passed');
