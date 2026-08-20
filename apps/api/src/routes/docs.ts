import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { skipAuth } from '../middleware/auth.ts';
import { AppError } from '../utils/errors.ts';
import type { PublicHono } from '../types/index.ts';

export const docsRouter: PublicHono = new Hono();

// Swagger UI's assets are served from this image rather than from a CDN. A
// third-party script on the origin that holds session tokens can read them, and
// `validatorUrl: none` is the same decision for the spec itself — nothing about
// this API is sent anywhere to render its own documentation.
const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve('swagger-ui-dist/package.json'));

const ASSET_CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Three Peaks Hub API</title>
    <link rel="stylesheet" href="/api/docs/static/swagger-ui-dist/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/api/docs/static/swagger-ui-dist/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        validatorUrl: 'none',
      });
    </script>
  </body>
</html>`;

docsRouter.get('/', skipAuth, (c) => c.html(HTML));

docsRouter.get('/static/swagger-ui-dist/:asset', skipAuth, async (c) => {
  // basename before join: the parameter is the only untrusted part of this
  // path, and `..` in it would otherwise read anything in the image.
  const asset = basename(c.req.param('asset'));
  const path = join(distDir, asset);

  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new AppError(404, 'Not Found');

  const extension = asset.slice(asset.lastIndexOf('.'));
  c.header('Content-Type', ASSET_CONTENT_TYPES[extension] ?? 'application/octet-stream');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
});
