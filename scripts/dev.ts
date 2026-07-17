// Development server. Ships nothing.
//
// Serves the app shell from web/, bundles src/app/main.ts on each request
// (milliseconds at this size, and always fresh), and exposes a library folder
// at /lib/* for the DevHttpTransport so demo scripts can exercise the full
// import-read-resume flow without a native folder picker.
//
//   LIBRARY_DIR=data/dev-library bun scripts/dev.ts

import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 4242);
const WEB_DIR = path.join(import.meta.dir, '..', 'web');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY_DIR ?? 'data/dev-library');

fs.mkdirSync(LIBRARY_DIR, { recursive: true });

async function bundle(): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, '..', 'src', 'app', 'main.ts')],
    target: 'browser',
  });
  if (!result.success) {
    console.error(result.logs.join('\n'));
    return new Response(`console.error(${JSON.stringify(result.logs.join('\n'))})`, {
      headers: { 'Content-Type': 'text/javascript' },
    });
  }
  const js = await result.outputs[0]?.text();
  return new Response(js ?? '', { headers: { 'Content-Type': 'text/javascript' } });
}

function libPath(pathname: string): string {
  const rel = decodeURIComponent(pathname.slice('/lib/'.length));
  const abs = path.resolve(LIBRARY_DIR, rel);
  if (!abs.startsWith(LIBRARY_DIR + path.sep) && abs !== LIBRARY_DIR) {
    throw new Error('path escapes library');
  }
  return abs;
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/lib/')) {
      const abs = libPath(url.pathname);
      if (req.method === 'GET') {
        if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
          return new Response('not found', { status: 404 });
        }
        return new Response(Bun.file(abs));
      }
      if (req.method === 'PUT') {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, new Uint8Array(await req.arrayBuffer()));
        return new Response('ok', { status: 200 });
      }
      return new Response('method not allowed', { status: 405 });
    }

    if (url.pathname === '/app.js') return bundle();
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const abs = path.join(WEB_DIR, file);
    if (abs.startsWith(WEB_DIR) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return new Response(Bun.file(abs));
    }
    // Hash routing means any other path is still the app.
    return new Response(Bun.file(path.join(WEB_DIR, 'index.html')));
  },
});

console.log(`reader-42 dev server: http://localhost:${PORT}  library: ${LIBRARY_DIR}`);
