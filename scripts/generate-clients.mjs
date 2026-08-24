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

const realtime = JSON.parse(
  readFileSync(new URL('../apps/api/realtime-events.json', import.meta.url), 'utf8')
);

const eventTypes = Object.keys(realtime.events).sort();
const closeCodes = Object.keys(realtime.closeCodes).sort();

// A payload field is either an id or the shape of a schema the spec already
// names, so an event carrying a row and the REST route returning it cannot
// describe it two ways. Resolved against the spec that was just dumped: a
// component renamed out from under the realtime document would otherwise
// generate a client referring to a type that does not exist.
const specSchemas = spec.components?.schemas ?? {};

function fieldType(name, type, field) {
  if (field === 'string') return 'string';
  const { component, field: property } = field;
  if (!specSchemas[component]) {
    throw new Error(
      `realtime payload ${type}.${name} names component '${component}', which the spec does not define`
    );
  }
  if (property && !specSchemas[component].properties?.[property]) {
    throw new Error(
      `realtime payload ${type}.${name} names ${component}['${property}'], which that component does not have`
    );
  }
  const base = `components['schemas']['${component}']`;
  return property ? `${base}['${property}']` : base;
}

// A discriminated union, so narrowing on event.type yields that event's payload
// and an apply site never asserts a shape.
const members = eventTypes
  .map((type) => {
    const payload = realtime.events[type].payload;
    const fields = Object.entries(payload)
      .map(([name, field]) => {
        const optional = field !== 'string' && field.optional ? '?' : '';
        return `      ${name}${optional}: ${fieldType(name, type, field)};`;
      })
      .join('\n');
    return `  | {\n      type: '${type}';\n${fields}\n    }`;
  })
  .join('\n');

// Only imported when something needs it: the union is otherwise ids and strings,
// and an unused import is an eslint failure in a committed file.
const needsComponents = eventTypes.some((type) =>
  Object.values(realtime.events[type].payload).some((field) => field !== 'string')
);

const realtimeSource = `// AUTO-GENERATED FROM apps/api's realtime document. DO NOT EDIT.
// Regenerate with: pnpm run generate
${needsComponents ? `\nimport type { components } from '../api/schema.generated.ts';\n` : ''}
export type RealtimeEventType =
${eventTypes.map((type) => `  | '${type}'`).join('\n')};

export type RealtimeEvent =
${members};

// The set a client has to route on. A code added at a close site but not in the
// server's table reaches no client at all.
export type RealtimeCloseCode = ${closeCodes.join(' | ')};
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
