import { type } from 'arktype';
import { resolver } from 'hono-openapi';

const errorSchema = type({ error: 'string' });
const validationErrorSchema = type({
  error: 'string',
  details: type({ path: 'string', message: 'string' }).array(),
});

// Spreadable response declarations. Error bodies never come from a handler
// return — they are thrown AppErrors surfaced by onError — so these stay
// ordinary spreads rather than joining the Returned<> pairing that response
// schemas use.
const jsonError = (description: string, schema: Parameters<typeof resolver>[0]) => ({
  description,
  content: { 'application/json': { schema: resolver(schema) } },
});

export const unauthorizedErrorResponse = { 401: jsonError('Unauthorized', errorSchema) };
export const forbiddenErrorResponse = { 403: jsonError('Forbidden', errorSchema) };
export const notFoundErrorResponse = { 404: jsonError('Not found', errorSchema) };
export const conflictErrorResponse = { 409: jsonError('Conflict', errorSchema) };
export const payloadTooLargeErrorResponse = { 413: jsonError('Payload too large', errorSchema) };
export const validationErrorResponse = {
  422: jsonError('Validation failed', validationErrorSchema),
};
export const internalServerErrorResponse = { 500: jsonError('Internal server error', errorSchema) };
