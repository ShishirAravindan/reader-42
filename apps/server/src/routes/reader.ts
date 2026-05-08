import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { items } from '../db/schema.ts';

const reader = new Hono();

reader.get('/:id/epub', async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  if (!item.epubPath || !fs.existsSync(item.epubPath)) {
    return c.json({ error: 'epub not ready' }, 404);
  }

  const file = Bun.file(item.epubPath);
  return new Response(file, {
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `inline; filename="${item.id}.epub"`,
    },
  });
});

reader.get('/:id/report', async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  if (!item.reportPath || !fs.existsSync(item.reportPath)) {
    return c.json({ report: null });
  }

  const content = await Bun.file(item.reportPath).text();
  return c.json({ report: JSON.parse(content) });
});

export default reader;
