import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { env } from '../config/env.ts';
import type { DB } from './types.ts';

const caCert = env.db.caCert;

export const pool = new pg.Pool({
  host: env.db.hostname,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  ssl: caCert ? { rejectUnauthorized: true, ca: caCert } : false,
  max: env.db.poolMax,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  // A request that has taken 30s is not going to succeed, and an abandoned
  // transaction holds locks until something kills it.
  options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
});

export const db = new Kysely<DB>({
  log: env.environment === 'development' ? ['error'] : ['error'],
  dialect: new PostgresDialect({ pool }),
});
