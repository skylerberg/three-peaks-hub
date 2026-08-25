import { writeFileSync } from 'node:fs';
import { realtimeEventsDocument } from '../src/services/realtime/document.ts';

// /ws has no HTTP request or response to put in the OpenAPI spec, so its event
// types are published as a second document, which clients generate from. The
// same builder answers GET /api/realtime-events.json, so the document a client
// generates from cannot differ from the one the API serves.
const document = realtimeEventsDocument();
writeFileSync(
  new URL('../realtime-events.json', import.meta.url),
  JSON.stringify(document, null, 2)
);
const schemas = (document.components as { schemas: Record<string, unknown> }).schemas;
const count = Object.keys(schemas).filter(
  (name) => name.endsWith('Event') && name !== 'RealtimeEvent'
).length;
console.log(`wrote realtime-events.json (${count} event types)`);
