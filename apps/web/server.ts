// Standalone dev server for the reader.
//
// Serves index.html, styles.css, /src/*.ts (transpiled on the fly via
// `Bun.Transpiler`), and the public/ directory (for /fixtures/).
//
// We don't use Bun's HTML routing because we want type-safe, dependency-free
// behavior without a magic HTML import.

const PORT = Number(Bun.env.PORT ?? 5173);
const ROOT = new URL('./', import.meta.url);

const transpiler = new Bun.Transpiler({ loader: 'ts' });

const server = Bun.serve({
  port: PORT,
  development: true,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;

    // Serve TS files transpiled to JS.
    if (path.endsWith('.ts')) {
      const target = new URL(`.${path}`, ROOT);
      const file = Bun.file(target);
      if (await file.exists()) {
        const source = await file.text();
        const js = transpiler.transformSync(source);
        return new Response(js, { headers: { 'Content-Type': 'application/javascript' } });
      }
    }

    // index.html
    if (path === '/index.html') {
      const file = Bun.file(new URL('./index.html', ROOT));
      if (await file.exists()) return new Response(file, { headers: { 'Content-Type': 'text/html' } });
    }

    // styles.css
    if (path === '/styles.css') {
      const file = Bun.file(new URL('./styles.css', ROOT));
      if (await file.exists()) return new Response(file, { headers: { 'Content-Type': 'text/css' } });
    }

    // /src/*.* assets (e.g., when imported relatively, the browser asks for /src/...)
    if (path.startsWith('/src/')) {
      const target = new URL(`.${path}`, ROOT);
      const file = Bun.file(target);
      if (await file.exists()) return new Response(file);
    }

    // Static files under /public/**
    const publicTarget = new URL(`./public${path}`, ROOT);
    const publicFile = Bun.file(publicTarget);
    if (await publicFile.exists()) {
      const headers = new Headers();
      if (path.endsWith('.epub')) headers.set('Content-Type', 'application/epub+zip');
      return new Response(publicFile, { headers });
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(`reader-42 web on http://localhost:${server.port}`);
