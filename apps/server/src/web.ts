// Serves the web reader from apps/web so one process owns :4242 — API and
// UI together, reachable from LAN devices. TypeScript modules are transpiled
// on the fly with Bun.Transpiler, keeping the no-build dev loop.

import path from 'node:path';
import { Hono } from 'hono';

const WEB_ROOT = path.resolve(import.meta.dir, '../../web');
const transpiler = new Bun.Transpiler({ loader: 'ts' });

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.epub': 'application/epub+zip',
  '.webmanifest': 'application/manifest+json',
};

const web = new Hono();

web.get('/*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const requested = pathname === '/' ? '/index.html' : pathname;
  if (requested.includes('..')) return c.notFound();

  // TS modules, transpiled per request.
  if (requested.endsWith('.ts')) {
    const file = Bun.file(path.join(WEB_ROOT, requested));
    if (await file.exists()) {
      const js = transpiler.transformSync(await file.text());
      return c.body(js, 200, { 'Content-Type': 'application/javascript' });
    }
  }

  // Static files: app root first (index.html, styles.css), then public/.
  for (const root of ['', 'public']) {
    const file = Bun.file(path.join(WEB_ROOT, root, requested));
    if (await file.exists()) {
      const ext = path.extname(requested);
      const type = CONTENT_TYPES[ext];
      return new Response(file, type ? { headers: { 'Content-Type': type } } : undefined);
    }
  }

  return c.notFound();
});

export default web;
