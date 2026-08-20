import { writeFileSync } from 'node:fs';
import { buildOpenApiSpec } from '../src/spec/openapi.ts';

// A pure function of src/: no database, no server, under two seconds. That is
// why the client generator re-dumps rather than reasoning about whether the
// last dump is stale, and why CI can run the drift check with no Postgres.
const spec = await buildOpenApiSpec();
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(spec, null, 2));
const paths = Object.keys((spec.paths ?? {}) as object).length;
const components = Object.keys((spec.components as never as { schemas?: object })?.schemas ?? {});
console.log(`wrote openapi.json (${paths} paths, ${components.length} named schemas)`);
