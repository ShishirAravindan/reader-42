// Dev server for the shelf spike: serves web/shelf.html over a KOReader
// library folder.
//
// The one thing it adds over scripts/dev.ts is a directory listing at /lib/,
// because under this arrangement there is no index file to read — the folder
// IS the index. A real deployment gets that listing from the drive API or from
// a local folder handle; here it comes from readdir.
//
// It also performs the handoff. POST /open with a filename and it launches
// KOReader on that book — which is the whole integration: the shelf decides
// WHAT to read and then gets out of the way. KOREADER points at the binary
// (koreader.sh, an AppImage, or whatever the platform calls it); without it
// the shelf still runs and the handoff reports that there is nothing to hand
// off to, rather than failing silently.
//
//   LIBRARY_DIR=/path/to/koreader/library bun scripts/shelf-dev.ts

import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 4310);
const WEB_DIR = path.join(import.meta.dir, '..', 'web');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY_DIR ?? 'data/koreader-library');
/** The reader. Absent, the shelf is honest about having nowhere to send you. */
const KOREADER = process.env.KOREADER ?? '';

fs.mkdirSync(LIBRARY_DIR, { recursive: true });

async function bundle(entry: 'shelf' | 'vision'): Promise<Response> {
  const result = await Bun.build({
    entrypoints: [path.join(import.meta.dir, '..', 'src', entry, 'main.ts')],
    target: 'browser',
  });
  if (!result.success) {
    console.error(result.logs.join('\n'));
    return new Response(`console.error(${JSON.stringify(result.logs.join('\n'))})`, {
      headers: { 'Content-Type': 'text/javascript' },
    });
  }
  return new Response((await result.outputs[0]?.text()) ?? '', {
    headers: { 'Content-Type': 'text/javascript' },
  });
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

    // The handoff: hand a real book to the real reader.
    if (url.pathname === '/open' && req.method === 'POST') {
      const { file } = (await req.json()) as { file?: string };
      if (!file) return Response.json({ ok: false, why: 'no file' }, { status: 400 });
      const abs = libPath(`/lib/${file}`);
      if (!fs.existsSync(abs))
        return Response.json({ ok: false, why: 'not found' }, { status: 404 });
      if (!KOREADER) {
        return Response.json({
          ok: false,
          why: 'KOREADER is not set',
          command: `koreader "${file}"`,
        });
      }
      // Detached on purpose: the reader outlives the request, and the shelf
      // has no business waiting on how long someone reads for.
      Bun.spawn([KOREADER, abs], { stdout: 'ignore', stderr: 'ignore' });
      console.log(`handoff -> ${file}`);
      return Response.json({ ok: true, launched: path.basename(KOREADER) });
    }

    // The folder is the index: one flat listing of what is actually there.
    if (url.pathname === '/lib/' || url.pathname === '/lib') {
      return Response.json(fs.readdirSync(LIBRARY_DIR));
    }

    if (url.pathname.startsWith('/lib/')) {
      const abs = libPath(url.pathname);
      if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
        return new Response('not found', { status: 404 });
      }
      return new Response(Bun.file(abs));
    }

    if (url.pathname === '/shelf.js') return bundle('shelf');
    // The pitch deck: screens that do not exist yet, in the shape they would
    // take. Served beside the real thing, and labelled as unbuilt on the page.
    if (url.pathname === '/vision.js') return bundle('vision');

    const file = url.pathname === '/' ? 'shelf.html' : url.pathname.slice(1);
    const abs = path.join(WEB_DIR, file);
    if (abs.startsWith(WEB_DIR) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return new Response(Bun.file(abs));
    }
    return new Response(Bun.file(path.join(WEB_DIR, 'shelf.html')));
  },
});

console.log(`reader-42 shelf: http://localhost:${PORT}  library: ${LIBRARY_DIR}`);
