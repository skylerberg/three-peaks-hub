import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  anonymous,
  createUser,
  deleteUser,
  uniqueEmail,
  type TestUser,
} from '../setup/testContext.ts';
import { sentEmails } from '../../src/services/email/index.ts';

describe('auth', () => {
  let user: TestUser;

  beforeAll(async () => {
    user = await createUser('auth');
  });

  afterAll(async () => {
    await deleteUser(user);
  });

  describe('signup', () => {
    it('creates an account and returns a usable token', async () => {
      const email = uniqueEmail('signup');
      const res = await anonymous.post('/api/auth/signup', {
        email,
        password: 'correct horse battery staple',
        name: 'New Person',
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.user.email).toBe(email);
      expect(body.user.email_verified).toBe(false);
      expect(body.token).toBeTypeOf('string');

      const me = await anonymous.withToken(body.token).get('/api/auth/me');
      expect(me.status).toBe(200);
      expect((await me.json()).id).toBe(body.user.id);

      await deleteUser({ ...body.user, token: body.token, api: anonymous } as TestUser);
    });

    it('answers 409 for an address already in use, case-insensitively', async () => {
      const res = await anonymous.post('/api/auth/signup', {
        email: user.email.toUpperCase(),
        password: 'correct horse battery staple',
        name: 'Impostor',
      });
      expect(res.status).toBe(409);
    });

    it('answers 422 for a password under the minimum', async () => {
      const res = await anonymous.post('/api/auth/signup', {
        email: uniqueEmail('short'),
        password: 'short',
        name: 'Person',
      });
      expect(res.status).toBe(422);
      expect((await res.json()).details).toBeInstanceOf(Array);
    });

    it('strips fields the schema does not declare', async () => {
      const email = uniqueEmail('strip');
      const res = await anonymous.post('/api/auth/signup', {
        email,
        password: 'correct horse battery staple',
        name: 'Person',
        email_verified: true,
      });
      expect(res.status).toBe(201);
      // The undeclared key was dropped rather than written: a client cannot
      // verify its own address by asking.
      expect((await res.json()).user.email_verified).toBe(false);
    });
  });

  describe('login', () => {
    it('exchanges credentials for a token', async () => {
      const res = await anonymous.post('/api/auth/login', {
        email: user.email,
        password: 'correct horse battery staple',
      });
      expect(res.status).toBe(200);
      expect((await res.json()).user.id).toBe(user.id);
    });

    it('answers 401 for a wrong password', async () => {
      const res = await anonymous.post('/api/auth/login', {
        email: user.email,
        password: 'not the password',
      });
      expect(res.status).toBe(401);
    });

    // The same status and the same body for both, so neither the response nor
    // its shape says whether the address has an account.
    it('answers 401 identically for an unknown address', async () => {
      const unknown = await anonymous.post('/api/auth/login', {
        email: uniqueEmail('nobody'),
        password: 'not the password',
      });
      const wrong = await anonymous.post('/api/auth/login', {
        email: user.email,
        password: 'not the password',
      });

      expect(unknown.status).toBe(401);
      expect(await unknown.json()).toEqual(await wrong.json());
    });
  });

  describe('the auth boundary', () => {
    it.each([
      ['GET', '/api/auth/me'],
      ['GET', '/api/auth/sessions'],
      ['GET', '/api/projects'],
      ['GET', '/api/files/directory?project_id=00000000-0000-4000-8000-000000000000'],
    ])('refuses %s %s without a token', async (method, path) => {
      const res = await anonymous[method.toLowerCase() as 'get'](path);
      expect(res.status).toBe(401);
    });

    it('refuses a token that is not a real credential', async () => {
      const res = await anonymous.withToken('not-a-real-token').get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it.each([['/health'], ['/'], ['/api/openapi.json']])(
      'serves %s without a token',
      async (path) => {
        const res = await anonymous.get(path);
        expect(res.status).toBe(200);
      }
    );
  });

  describe('sessions', () => {
    it('lists the current session and marks it current', async () => {
      const res = await user.api.get('/api/auth/sessions');
      expect(res.status).toBe(200);
      const { sessions } = await res.json();
      expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    });

    it('signs out only the session that was used', async () => {
      const second = await anonymous.post('/api/auth/login', {
        email: user.email,
        password: 'correct horse battery staple',
      });
      const secondToken = (await second.json()).token;

      const logout = await anonymous.withToken(secondToken).post('/api/auth/logout');
      expect(logout.status).toBe(204);

      expect((await anonymous.withToken(secondToken).get('/api/auth/me')).status).toBe(401);
      // The first session is untouched.
      expect((await user.api.get('/api/auth/me')).status).toBe(200);
    });

    it('answers 404 for a session id belonging to someone else', async () => {
      const other = await createUser('other');
      const { sessions } = await (await other.api.get('/api/auth/sessions')).json();

      // 404 rather than 403: a 403 would confirm the id exists.
      const res = await user.api.delete(`/api/auth/sessions/${sessions[0].id}`);
      expect(res.status).toBe(404);

      expect((await other.api.get('/api/auth/me')).status).toBe(200);
      await deleteUser(other);
    });
  });

  describe('password reset', () => {
    it('mails a link that sets a new password exactly once', async () => {
      const person = await createUser('reset');

      const requested = await anonymous.post('/api/auth/forgot-password', {
        email: person.email,
      });
      expect(requested.status).toBe(204);

      const mail = sentEmails().find((message) => message.to === person.email);
      expect(mail, 'a reset email should have been sent').toBeDefined();

      const token = /token=([^\s&]+)/.exec(mail!.text)?.[1];
      expect(token).toBeTypeOf('string');

      const reset = await anonymous.post('/api/auth/reset-password', {
        token: decodeURIComponent(token!),
        password: 'a brand new passphrase',
      });
      expect(reset.status).toBe(204);

      const login = await anonymous.post('/api/auth/login', {
        email: person.email,
        password: 'a brand new passphrase',
      });
      expect(login.status).toBe(200);

      // Rotating alternative_id is what makes the link single-use.
      const replay = await anonymous.post('/api/auth/reset-password', {
        token: decodeURIComponent(token!),
        password: 'yet another passphrase',
      });
      expect(replay.status).toBe(401);

      await deleteUser(person);
    });

    it('answers 404 for an address with no account', async () => {
      const res = await anonymous.post('/api/auth/forgot-password', {
        email: uniqueEmail('ghost'),
      });
      expect(res.status).toBe(404);
    });

    it('refuses a forged token', async () => {
      const res = await anonymous.post('/api/auth/reset-password', {
        token: 'bm90LWEtdG9rZW4.c2lnbmF0dXJl',
        password: 'a brand new passphrase',
      });
      expect(res.status).toBe(401);
    });
  });
});
