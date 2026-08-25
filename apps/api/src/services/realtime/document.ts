import { CLOSE_CODES, CLOSE_CODE_REASONS } from './closeCodes.ts';
import { EVENT_CATALOG, type RealtimeEventType } from './eventCatalog.ts';
import { REALTIME_PAYLOAD_SCHEMAS } from './payloads.ts';

// /ws carries no HTTP request or response, so none of it can live in
// openapi.json. This is the second document: an OpenAPI 3.1 file describing the
// socket envelope and the close codes, declaring no paths, which the clients
// generate types from exactly as they generate the API client from the spec.
//
// Built from the payload schemas rather than from a table of field names beside
// them. A second table is a second answer -- it drifts, and while it existed it
// could describe nothing but strings.

function eventSchemaName(eventType: RealtimeEventType): string {
  const pascal = eventType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return `${pascal}Event`;
}

export function realtimeEventsDocument(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  const refs: { $ref: string }[] = [];

  for (const eventType of Object.keys(EVENT_CATALOG).sort() as RealtimeEventType[]) {
    const name = eventSchemaName(eventType);
    schemas[name] = {
      type: 'object',
      properties: {
        type: { type: 'string', const: eventType },
        // Named on the envelope rather than left to the payload: it is what
        // delivery routes on, and a row that happens not to carry one would
        // otherwise reach nobody.
        project_id: { type: 'string' },
        data: REALTIME_PAYLOAD_SCHEMAS[eventType].toJsonSchema(),
      },
      required: ['type', 'project_id', 'data'],
      additionalProperties: false,
    };
    refs.push({ $ref: `#/components/schemas/${name}` });
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Three Peaks Hub realtime events',
      version: '2.0.0',
      description:
        'Generated from the declaration tables in src/services/realtime by `pnpm run realtime:dump`. ' +
        'RealtimeEvent is the envelope a /ws socket receives and RealtimeCloseCode is what that ' +
        'socket can be closed with. Not an HTTP API: it declares no paths.',
    },
    paths: {},
    components: {
      schemas: {
        RealtimeEvent: { oneOf: refs },
        // A generator keeps a schema's own description and drops its members',
        // so every code's meaning has to be in this one string or it does not
        // cross the boundary at all.
        RealtimeCloseCode: {
          description:
            'Close codes a /ws socket can be closed with, beyond the standard RFC 6455 ones. ' +
            Object.entries(CLOSE_CODES)
              .map(([name, code]) => `${String(code)} (${name}): ${CLOSE_CODE_REASONS[code]}`)
              .join(' '),
          oneOf: Object.entries(CLOSE_CODES).map(([name, code]) => ({
            type: 'integer',
            const: code,
            title: name,
          })),
        },
        ...schemas,
      },
    },
  };
}
