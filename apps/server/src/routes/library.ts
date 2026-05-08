import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.ts';
import { items } from '../db/schema.ts';

const library = new Hono();

library.get('/', async (c) => {
  const all = await db.select().from(items).orderBy(desc(items.capturedAt));
  return c.json({ items: all });
});

library.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  return c.json({ item });
});

export default library;
