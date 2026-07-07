import { zValidator } from '@hono/zod-validator';
import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db/client.ts';
import { highlights, items } from '../db/schema.ts';

const pathSchema = z.array(z.number().int().min(0)).max(32);

const createSchema = z.object({
  chapter: z.number().int().min(0),
  startPath: pathSchema,
  startOffset: z.number().int().min(0),
  endPath: pathSchema,
  endOffset: z.number().int().min(0),
  text: z.string().min(1).max(5000),
  note: z.string().max(5000).nullish(),
});

const noteSchema = z.object({ note: z.string().max(5000).nullable() });

/** Sub-app mounted at /library/:id/highlights. */
const router = new Hono();

async function itemExists(id: string): Promise<boolean> {
  const [item] = await db.select({ id: items.id }).from(items).where(eq(items.id, id)).limit(1);
  return item !== undefined;
}

function serialize(row: typeof highlights.$inferSelect) {
  return {
    ...row,
    startPath: JSON.parse(row.startPath) as number[],
    endPath: JSON.parse(row.endPath) as number[],
  };
}

router.get('/', async (c) => {
  const itemId = c.req.param('id');
  if (!itemId || !(await itemExists(itemId))) return c.json({ error: 'not found' }, 404);
  const rows = await db
    .select()
    .from(highlights)
    .where(eq(highlights.itemId, itemId))
    .orderBy(asc(highlights.chapter), asc(highlights.startOffset), asc(highlights.createdAt));
  return c.json({ highlights: rows.map(serialize) });
});

router.post('/', zValidator('json', createSchema), async (c) => {
  const itemId = c.req.param('id');
  if (!itemId || !(await itemExists(itemId))) return c.json({ error: 'not found' }, 404);
  const body = c.req.valid('json');
  const [row] = await db
    .insert(highlights)
    .values({
      id: crypto.randomUUID(),
      itemId,
      chapter: body.chapter,
      startPath: JSON.stringify(body.startPath),
      startOffset: body.startOffset,
      endPath: JSON.stringify(body.endPath),
      endOffset: body.endOffset,
      text: body.text,
      note: body.note ?? null,
      createdAt: new Date(),
    })
    .returning();
  if (!row) return c.json({ error: 'insert failed' }, 500);
  return c.json({ highlight: serialize(row) }, 201);
});

router.patch('/:hid', zValidator('json', noteSchema), async (c) => {
  const hid = c.req.param('hid');
  const { note } = c.req.valid('json');
  const [row] = await db.update(highlights).set({ note }).where(eq(highlights.id, hid)).returning();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ highlight: serialize(row) });
});

router.delete('/:hid', async (c) => {
  const hid = c.req.param('hid');
  const [row] = await db.delete(highlights).where(eq(highlights.id, hid)).returning();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

export default router;
