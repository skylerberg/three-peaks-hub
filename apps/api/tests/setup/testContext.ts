import { app } from '../../src/index.ts';
import { db } from '../../src/db/index.ts';

// Bodies have no compile-time link to the route that produced them, so this is
// deliberately loose. Name the shape at the call site with res.json<T>() where
// it matters rather than pretending the client is typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = any;

interface TestResponse {
  status: number;
  headers: Headers;
  json<T = JsonBody>(): Promise<T>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

// Fakes what @hono/node-server puts on the context, so anything reading the
// source address (rate limiting, abuse ceilings) has one.
function nodeBindings(address: string) {
  return {
    incoming: {
      socket: { remoteAddress: address, remotePort: 51234, remoteFamily: 'IPv4' },
    },
  };
}

class TestApiClient {
  constructor(
    private readonly token: string | null = null,
    private readonly sourceAddress = '203.0.113.10'
  ) {}

  withToken(token: string | null): TestApiClient {
    return new TestApiClient(token, this.sourceAddress);
  }

  withSourceAddress(address: string): TestApiClient {
    return new TestApiClient(this.token, address);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  private async send(
    method: string,
    path: string,
    init?: { body?: BodyInit; headers?: Record<string, string> }
  ): Promise<TestResponse> {
    const res = await app.request(
      path,
      { method, body: init?.body, headers: this.headers(init?.headers) },
      nodeBindings(this.sourceAddress)
    );
    return res as unknown as TestResponse;
  }

  get(path: string) {
    return this.send('GET', path);
  }

  post(path: string, body?: unknown) {
    return this.send('POST', path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  put(path: string, body?: unknown) {
    return this.send('PUT', path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  patch(path: string, body?: unknown) {
    return this.send('PATCH', path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  delete(path: string) {
    return this.send('DELETE', path);
  }

  // Raw bytes with the metadata in the query string, which is how uploads
  // actually arrive.
  postBytes(path: string, body: BodyInit, contentType = 'application/octet-stream') {
    return this.send('POST', path, { body, headers: { 'Content-Type': contentType } });
  }

  // Deliberately not JSON.stringify'd, for the malformed-body cases.
  sendRawJson(method: string, path: string, raw: string) {
    return this.send(method, path, { body: raw, headers: { 'Content-Type': 'application/json' } });
  }
}

export const anonymous = new TestApiClient();

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
  api: TestApiClient;
}

let userCounter = 0;

export function uniqueEmail(prefix = 'user'): string {
  userCounter += 1;
  return `${prefix}-${process.pid}-${Date.now()}-${userCounter}@example.test`;
}

// Signs up over the real HTTP surface rather than inserting a row, so every
// test account exists the way a real one does.
export async function createUser(prefix = 'user'): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const res = await anonymous.post('/api/auth/signup', {
    email,
    password: 'correct horse battery staple',
    name: `Test ${prefix}`,
  });

  if (res.status !== 201) {
    throw new Error(`signup failed with ${res.status}: ${await res.text()}`);
  }

  const body = await res.json();
  return {
    id: body.user.id,
    email,
    name: body.user.name,
    token: body.token,
    api: new TestApiClient(body.token),
  };
}

// project.created_by is ON DELETE RESTRICT, so owned projects go first.
export async function deleteUser(user: TestUser): Promise<void> {
  await db.deleteFrom('project').where('project.created_by', '=', user.id).execute();
  await db.deleteFrom('app_user').where('app_user.id', '=', user.id).execute();
}
