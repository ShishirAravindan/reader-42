import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, app: 'reader-42' }));

const port = Number(Bun.env.PORT ?? 4242);

console.log(`reader-42 server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
