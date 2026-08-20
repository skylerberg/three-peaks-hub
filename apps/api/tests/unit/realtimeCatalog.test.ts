import { describe, expect, it } from 'vitest';
import { CLOSE_CODES, CLOSE_CODE_REASONS } from '../../src/services/realtime/closeCodes.ts';
import { EVENT_CATALOG } from '../../src/services/realtime/eventCatalog.ts';
import { realtimeEventsDocument } from '../../src/services/realtime/document.ts';

// The catalog, the payload table and the published document are three views of
// one set. These hold them to each other, because the failure they prevent is
// silent: an event type the server publishes and no client can name.
describe('the realtime event tables', () => {
  const document = realtimeEventsDocument();

  it('publishes exactly the catalog', () => {
    expect(Object.keys(document.events).sort()).toEqual(Object.keys(EVENT_CATALOG).sort());
  });

  it('gives every event a project_id, which is what delivery routes on', () => {
    for (const [type, entry] of Object.entries(document.events)) {
      expect(entry.payload, `${type} must carry project_id`).toContain('project_id');
    }
  });

  it('names the acting user on every event whose catalog row says so', () => {
    for (const [type, entry] of Object.entries(EVENT_CATALOG)) {
      const payload = document.events[type].payload;
      expect(payload.includes('actor_user_id'), type).toBe(entry.carriesActor);
    }
  });

  it('publishes every close code the server can send', () => {
    expect(Object.keys(document.closeCodes).map(Number).sort()).toEqual(
      Object.values(CLOSE_CODES).sort()
    );
  });

  it('gives every close code a reason', () => {
    for (const code of Object.values(CLOSE_CODES)) {
      expect(CLOSE_CODE_REASONS[code]).toBeTruthy();
    }
  });
});
