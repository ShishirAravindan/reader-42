import path from 'node:path';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { Hono } from 'hono';

import { db } from './db/client.ts';
import capture from './routes/capture.ts';
import library from './routes/library.ts';
import reader from './routes/reader.ts';

const migrationsFolder = path.resolve(import.meta.dir, '../drizzle');
migrate(db, { migrationsFolder });

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, app: 'reader-42' }));
app.route('/capture', capture);
app.route('/library', library);
app.route('/reader', reader);

const port = Number(Bun.env.PORT ?? 4242);

console.log(`reader-42 server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
