import type { Context, Hono } from 'hono';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/types.ts';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
}

type CredentialKind = 'session' | 'personal_access_token';

export interface Credential {
  kind: CredentialKind;
  id: string;
  user: AuthenticatedUser;
}

export type Connection = Kysely<DB> | Transaction<DB>;

export type PostCommitHook = () => void | Promise<void>;

interface BaseVariables {
  db: Connection;
  postCommitHooks: PostCommitHook[];
  credential?: Credential;
}

// Two shapes of the same variable map, and the difference is the whole point.
// A handler mounted on AppHono gets a `user` that is a user; one mounted on
// PublicHono gets `AuthenticatedUser | undefined`. Reading the user on a public
// route is therefore a compile error rather than a runtime `undefined` that
// reaches a query.
export type Variables = BaseVariables & { user?: AuthenticatedUser };
type AuthedVariables = BaseVariables & { user: AuthenticatedUser };

export type AppContext = Context<{ Variables: AuthedVariables }>;
export type PublicContext = Context<{ Variables: Variables }>;

export type AppHono = Hono<{ Variables: AuthedVariables }>;
export type PublicHono = Hono<{ Variables: Variables }>;

// A service that never reads the user takes this, so either kind of route can
// call it. One that does read the user takes Pick<AppContext, 'get'>, which is
// what stops a public route from reaching it.
export type AnyContextGetter = Pick<PublicContext, 'get'>;
