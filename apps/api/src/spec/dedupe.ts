import { canonicalize, type SchemaRegistry } from './schemaRegistry.ts';

// Replaces every inline schema that matches a registered one with a $ref, and
// collects the referenced definitions into components.schemas.
export function deduplicateSpec(
  spec: Record<string, unknown>,
  registry: SchemaRegistry
): Record<string, unknown> {
  const used = new Set<string>();

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;

    const record = node as Record<string, unknown>;
    // A node that already is a $ref is finished.
    if (typeof record.$ref === 'string') return record;

    const name = registry.byShape.get(canonicalize(record));
    if (name) {
      used.add(name);
      return { $ref: `#/components/schemas/${name}` };
    }

    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, walk(value)]));
  }

  const paths = walk(spec.paths);
  const components = (spec.components ?? {}) as Record<string, unknown>;
  const existing = (components.schemas ?? {}) as Record<string, unknown>;

  const schemas: Record<string, unknown> = { ...existing };
  for (const name of [...used].sort()) {
    // Definitions are stored unwalked: a schema that contains another named
    // schema inline is still correct, just less compact, and walking them would
    // let a definition $ref itself.
    schemas[name] = registry.definitions.get(name);
  }

  return { ...spec, paths, components: { ...components, schemas } };
}

// Two routes sharing an operationId produce a client where one silently
// overwrites the other.
export function assertUniqueOperationIds(spec: Record<string, unknown>): Record<string, unknown> {
  const seen = new Map<string, string>();
  const paths = (spec.paths ?? {}) as Record<string, Record<string, { operationId?: string }>>;

  for (const [path, operations] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      const id = operation?.operationId;
      if (!id) continue;
      const where = `${method.toUpperCase()} ${path}`;
      const previous = seen.get(id);
      if (previous) throw new Error(`Duplicate operationId "${id}": ${previous} and ${where}`);
      seen.set(id, where);
    }
  }

  return spec;
}
