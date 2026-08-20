import { generateSpecs } from 'hono-openapi';
import { APP_NAME } from '../config/constants.ts';
import { deduplicateSpec, assertUniqueOperationIds } from './dedupe.ts';
import { buildSchemaNameRegistry } from './schemaRegistry.ts';

// One options object, used by the served route and by the dump script, so the
// spec a client is generated from cannot differ from the one the API serves.
function openApiOptions() {
  return {
    documentation: {
      info: {
        title: `${APP_NAME} API`,
        version: '1.0.0',
        description: 'Board game design tools: accounts, projects and project-scoped files.',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Session or personal access token',
          },
        },
      },
      servers: [{ url: '/', description: 'This server' }],
    },
  };
}

// Built once per process. The registry walks every export of the schemas
// barrel, which is cheap but not free, and the spec is immutable at runtime.
let cached: Promise<Record<string, unknown>> | null = null;

export async function buildOpenApiSpec(): Promise<Record<string, unknown>> {
  const { app } = await import('../index.ts');
  const registry = buildSchemaNameRegistry();
  const raw = (await generateSpecs(app as never, openApiOptions() as never)) as unknown as Record<
    string,
    unknown
  >;
  return assertUniqueOperationIds(deduplicateSpec(raw, registry));
}

export function openApiSpec(): Promise<Record<string, unknown>> {
  cached ??= buildOpenApiSpec();
  return cached;
}
