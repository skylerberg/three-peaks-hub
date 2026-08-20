import { env } from '../../src/config/env.ts';
import { RESETTABLE_DATABASE, resolveTestDatabaseName } from './testDatabaseName.ts';

// Runs inside every forked worker, not just the parent. A worker that somehow
// got a different DB_DATABASE would otherwise quietly run the suite against it.
if (env.environment !== 'test') {
  throw new Error(`Refusing to run tests with ENVIRONMENT=${env.environment}`);
}

const expected = resolveTestDatabaseName();
if (env.db.database !== expected) {
  throw new Error(
    `Test database must be the derived name.\n  expected: ${expected}\n  actual:   ${env.db.database}\n` +
      'Do not set DB_DATABASE to reach a specific database; it is computed from the checkout path.'
  );
}

if (!RESETTABLE_DATABASE.test(expected)) {
  throw new Error(`Derived test database name does not look like a test database: ${expected}`);
}
