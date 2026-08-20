import { type } from 'arktype';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { jsonValidator } from '../../src/middleware/validators.ts';

// The route handlers all read their body field by field and never spread it, so
// an undeclared key could not reach a query even without stripping -- which
// means an e2e test of a route cannot observe this at all. It is checked here,
// on the validator's own output, so the guard has something real to break.
function probe() {
  const app = new Hono();
  app.post(
    '/probe',
    jsonValidator(type({ name: 'string', 'nickname?': 'string' })),
    // Echoes the validated value rather than a hand-picked field, which is the
    // only way the stripping is visible.
    (c) => c.json({ received: c.req.valid('json') })
  );
  return app;
}

async function post(body: unknown) {
  const res = await probe().request('/probe', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
  return { status: res.status, body: await res.json() };
}

describe('jsonValidator', () => {
  it('passes declared fields through', async () => {
    const { status, body } = await post({ name: 'Skyler', nickname: 'Sky' });
    expect(status).toBe(200);
    expect(body.received).toEqual({ name: 'Skyler', nickname: 'Sky' });
  });

  it('strips a key the schema does not declare', async () => {
    const { status, body } = await post({ name: 'Skyler', email_verified: true, role: 'admin' });
    expect(status).toBe(200);
    expect(body.received).toEqual({ name: 'Skyler' });
    expect(body.received).not.toHaveProperty('email_verified');
    expect(body.received).not.toHaveProperty('role');
  });

  it('answers 422 with a details array when a declared field is wrong', async () => {
    const { status, body } = await post({ name: 42 });
    expect(status).toBe(422);
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
    expect(body.details[0]).toHaveProperty('message');
  });

  it('answers 422 when a required field is missing', async () => {
    expect((await post({ nickname: 'Sky' })).status).toBe(422);
  });
});
