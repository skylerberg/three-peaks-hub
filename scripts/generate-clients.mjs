// Dumps the API's spec and regenerates the committed clients in
// packages/shared. One repo means the spec is always the working tree, so there
// is no sibling-checkout discovery, no freshness heuristic and no fallback to a
// deployed API -- all of which the two-repo original needed and none of which
// can be right here. What replaces them is `pnpm check:generated`, which
// regenerates and fails on any diff.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });

console.log('dumping the API spec...');
run('pnpm', ['--filter', '@three-peaks/api', 'run', 'openapi:dump'], root);

const specPath = new URL('../apps/api/openapi.json', import.meta.url);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const ast = await openapiTS(spec);
const body = astToString(ast);

const header = `// AUTO-GENERATED FROM apps/api's OpenAPI spec. DO NOT EDIT.
// Regenerate with: pnpm run generate
//
// Committed on purpose: apps/web must type-check, build and run on a fresh
// clone with no database and no API process, and the diff is what makes a
// breaking change to the API surface visible in review.
`;

const target = new URL('../packages/shared/src/api/schema.generated.ts', import.meta.url);
writeFileSync(target, header + body);

console.log('formatting...');
run(
  'pnpm',
  [
    'exec',
    'prettier',
    '--write',
    '--log-level',
    'warn',
    'packages/shared/src/api/schema.generated.ts',
  ],
  root
);

console.log('wrote packages/shared/src/api/schema.generated.ts');

// --- realtime ---------------------------------------------------------------
console.log('dumping the realtime event document...');
run('pnpm', ['--filter', '@three-peaks/api', 'run', 'realtime:dump'], root);

const realtimeDoc = JSON.parse(
  readFileSync(new URL('../apps/api/realtime-events.json', import.meta.url), 'utf8')
);

// The same generator as the API client, because the realtime document is now an
// OpenAPI file too. It was a hand-rolled string emitter while a payload was a
// list of field names -- which is all such an emitter can describe, and the
// reason no event could carry a row.
const realtimeAst = await openapiTS(realtimeDoc);
const realtimeBody = astToString(realtimeAst);

const realtimeSource = `// AUTO-GENERATED FROM apps/api's realtime document. DO NOT EDIT.
// Regenerate with: pnpm run generate

${realtimeBody}

// A discriminated union, so narrowing on event.type yields that event's data and
// an apply site never asserts a shape.
export type RealtimeEvent = components['schemas']['RealtimeEvent'];
export type RealtimeEventType = RealtimeEvent['type'];

// The set a client has to route on. A code added at a close site but not in the
// server's table reaches no client at all.
export type RealtimeCloseCode = components['schemas']['RealtimeCloseCode'];
`;

writeFileSync(
  new URL('../packages/shared/src/realtime/events.generated.ts', import.meta.url),
  realtimeSource
);
run(
  'pnpm',
  [
    'exec',
    'prettier',
    '--write',
    '--log-level',
    'warn',
    'packages/shared/src/realtime/events.generated.ts',
  ],
  root
);
console.log('wrote packages/shared/src/realtime/events.generated.ts');
