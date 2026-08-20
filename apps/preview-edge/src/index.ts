import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { Storage } from '@google-cloud/storage';

// Serves each pull request's static build out of a pr/<n>/ prefix in the web
// bucket. The load balancer routes *.tools.threepeaksgames.com here for
// everything except /api, /ws and /health, so a preview is a full same-origin
// virtual host and needs no CORS.

const WEB_BUCKET = process.env.WEB_BUCKET ?? '';
const PREVIEW_HOST_SUFFIX = process.env.PREVIEW_HOST_SUFFIX ?? '';
const PORT = Number(process.env.PORT ?? 8080);

if (!WEB_BUCKET) throw new Error('WEB_BUCKET is required');

const storage = new Storage();
const bucket = storage.bucket(WEB_BUCKET);

const PREVIEW_HOST = /^pr-(\d+)\./;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function previewNumber(host: string | undefined): string | null {
  if (!host) return null;
  const name = host.split(':')[0].toLowerCase();
  if (PREVIEW_HOST_SUFFIX && !name.endsWith(PREVIEW_HOST_SUFFIX)) return null;
  return PREVIEW_HOST.exec(name)?.[1] ?? null;
}

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/__health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      return;
    }

    const number = previewNumber(req.headers.host);
    if (!number) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not a preview host');
      return;
    }

    const url = new URL(req.url ?? '/', 'http://preview.invalid');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const key = `pr/${number}${pathname}`;

    let file = bucket.file(key);
    let [exists] = await file.exists();

    // SPA fallback, and the distinction matters: a route-like path falls back
    // to that PR's shell, while a missing asset stays a 404 so a broken build is
    // not masked as HTML the browser then fails to parse.
    if (!exists && (!HAS_EXTENSION.test(pathname) || pathname.endsWith('.html'))) {
      file = bucket.file(`pr/${number}/index.html`);
      [exists] = await file.exists();
    }

    if (!exists) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const [metadata] = await file.getMetadata();
    const name = file.name;
    const extension = name.slice(name.lastIndexOf('.'));

    res.writeHead(200, {
      'Content-Type':
        metadata.contentType ?? CONTENT_TYPES[extension] ?? 'application/octet-stream',
      // Previews are force-pushed to the same prefix, so nothing here may be
      // cached by a shared cache.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });

    const stream = file.createReadStream() as unknown as Readable;
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(PORT, () => console.log(`preview edge listening on :${PORT}`));
