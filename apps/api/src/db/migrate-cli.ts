// The migrate Job's entrypoint, and `pnpm migrate`. It is its own file because
// migrate.ts is imported by the server, which ships as a single esbuild bundle:
// a top-level block there becomes a top-level block in dist/index.mjs.
import { db } from './index.ts';
import { runMigrations } from './migrate.ts';
import { logger } from '../utils/logger.ts';

const direction = process.argv[2] === 'down' ? 'down' : 'up';

try {
  await runMigrations(direction);
  logger.info('migrations complete');
  await db.destroy();
} catch (error) {
  logger.error('migration run failed', { error });
  await db.destroy();
  process.exit(1);
}
