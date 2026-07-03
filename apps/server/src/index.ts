import path from 'node:path';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Hono } from 'hono';

import { db } from './db/client.ts';
import library from './routes/library.ts';
import reader from './routes/reader.ts';
import web from './web.ts';

const migrationsFolder = path.resolve(import.meta.dir, '../drizzle');
migrate(db, { migrationsFolder });

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, app: 'reader-42' }));
app.route('/library', library);
app.route('/reader', reader);
// Static web reader — registered last so API routes win.
app.route('/', web);

const port = Number(Bun.env.PORT ?? 4242);

console.log(`reader-42 server listening on http://localhost:${port}`);

export { app };

export default {
  port,
  fetch: app.fetch,
};
