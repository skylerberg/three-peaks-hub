import { validator } from 'hono-openapi';
import type { Type } from 'arktype';
import { AppError } from '../utils/errors.ts';

interface ValidationIssue {
  path?: readonly (PropertyKey | { key: PropertyKey })[];
  message: string;
}

function formatIssues(issues: readonly ValidationIssue[]) {
  return issues.map((issue) => ({
    path: (issue.path ?? [])
      .map((segment) =>
        typeof segment === 'object' && segment !== null ? String(segment.key) : String(segment)
      )
      .join('.'),
    message: issue.message,
  }));
}

// Strips keys the schema does not declare rather than rejecting them, so a
// client sending a field the server stopped reading keeps working — and a field
// the server never declared can never reach a query.
//
// The validator comes from hono-openapi rather than @hono/standard-validator:
// this one also registers the request schema in the generated spec, which is
// what the client is generated from.
export function jsonValidator<T extends Type>(schema: T) {
  const stripped = schema.onUndeclaredKey('delete');
  return validator('json', stripped as never, (result, c) => {
    if (result.success) return;
    return c.json(
      {
        error: 'Validation failed',
        details: formatIssues(result.error as unknown as ValidationIssue[]),
      },
      422
    );
  });
}

export function queryValidator<T extends Type>(schema: T) {
  return validator('query', schema as never, (result) => {
    if (result.success) return;
    throw new AppError(400, 'Invalid query parameter');
  });
}
