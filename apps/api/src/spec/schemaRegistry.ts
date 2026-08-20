import { Type } from 'arktype';
import * as schemas from '../schemas/index.ts';

// Component names come from the named exports of the schemas barrel. That is
// why convention 7 exists: a schema not re-exported there appears inline in the
// spec, and the generated client gets an anonymous duplicate instead of a
// shared named type.

function toComponentName(exportName: string): string {
  // signupRequestSchema -> SignupRequest
  const withoutSuffix = exportName.replace(/Schema$/, '');
  return withoutSuffix.charAt(0).toUpperCase() + withoutSuffix.slice(1);
}

// Key ignores property order so two structurally identical schemas collide
// regardless of how they were written.
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      // $schema is a document-level annotation, not part of the shape.
      .filter(([key]) => key !== '$schema')
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface SchemaRegistry {
  byShape: Map<string, string>;
  definitions: Map<string, unknown>;
}

export function buildSchemaNameRegistry(): SchemaRegistry {
  const byShape = new Map<string, string>();
  const definitions = new Map<string, unknown>();

  for (const [exportName, value] of Object.entries(schemas)) {
    if (!(value instanceof Type)) continue;

    let jsonSchema: unknown;
    try {
      jsonSchema = value.toJsonSchema();
    } catch {
      // Not every arktype construct has a JSON Schema form. One that does not
      // simply stays inline rather than failing the dump.
      continue;
    }

    const shape = canonicalize(jsonSchema);
    const name = toComponentName(exportName);

    const existing = byShape.get(shape);
    if (existing && existing !== name) {
      // Two names for one shape would make the $ref this registry writes
      // ambiguous, and the client's type would depend on iteration order.
      throw new Error(
        `Two schemas have identical JSON Schema: ${existing} and ${name}. ` +
          `Give one of them a distinguishing field, or export only one.`
      );
    }

    byShape.set(shape, name);
    definitions.set(name, jsonSchema);
  }

  return { byShape, definitions };
}
