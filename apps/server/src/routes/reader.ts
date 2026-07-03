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
  if (!fs.existsSync(item.epubPath)) {
    return c.json({ error: 'epub file missing' }, 404);
  }

  const file = Bun.file(item.epubPath);
  return new Response(file, {
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `inline; filename="${item.id}.epub"`,
    },
  });
});

export default reader;
