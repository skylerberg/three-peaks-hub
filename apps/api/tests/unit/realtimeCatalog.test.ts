import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, CLOSE_CODE_REASONS } from '../../src/services/realtime/closeCodes.ts';
import { EVENT_CATALOG } from '../../src/services/realtime/eventCatalog.ts';
import { REALTIME_PAYLOAD_SCHEMAS } from '../../src/services/realtime/payloads.ts';
import { realtimeEventsDocument } from '../../src/services/realtime/document.ts';

// The catalog, the payload table and the published document are three views of
// one set. These hold them to each other, because the failure they prevent is
// silent: an event type the server publishes and no client can name.
describe('the realtime event tables', () => {
  const document = realtimeEventsDocument();
  const schemas = (document.components as { schemas: Record<string, Record<string, unknown>> })
    .schemas;

  function eventSchemaName(eventType: string): string {
    return `${eventType
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join('')}Event`;
  }

  it('publishes exactly the catalog', () => {
    const published = Object.keys(schemas)
      .filter((name) => name.endsWith('Event') && name !== 'RealtimeEvent')
      .sort();
    expect(published).toEqual(Object.keys(EVENT_CATALOG).map(eventSchemaName).sort());
  });

  it('gives every event a payload schema', () => {
    for (const eventType of Object.keys(EVENT_CATALOG)) {
      expect(
        REALTIME_PAYLOAD_SCHEMAS[eventType as keyof typeof REALTIME_PAYLOAD_SCHEMAS]
      ).toBeDefined();
    }
  });

  // project_id rides the envelope rather than the payload: it is what delivery
  // routes on, and a row that happens not to carry one would reach nobody.
  it('names project_id on every envelope, not on the row', () => {
    for (const eventType of Object.keys(EVENT_CATALOG)) {
      const schema = schemas[eventSchemaName(eventType)];
      expect(schema.required, eventType).toContain('project_id');
      expect(schema.required, eventType).toContain('data');
    }
  });

  it('names the acting user on every event whose catalog row says so', () => {
    for (const [eventType, entry] of Object.entries(EVENT_CATALOG)) {
      const data = (
        schemas[eventSchemaName(eventType)].properties as { data: { required?: string[] } }
      ).data;
      expect(data.required?.includes('actor_user_id') ?? false, eventType).toBe(entry.carriesActor);
    }
  });

  it('publishes every close code the server can send', () => {
    const codes = (schemas.RealtimeCloseCode.oneOf as { const: number }[]).map((one) => one.const);
    expect(codes.sort()).toEqual(Object.values(CLOSE_CODES).sort());
  });

  it('gives every close code a reason', () => {
    for (const code of Object.values(CLOSE_CODES)) {
      expect(CLOSE_CODE_REASONS[code]).toBeTruthy();
    }
  });
});
