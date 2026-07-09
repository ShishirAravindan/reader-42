import fs from 'node:fs';
import path from 'node:path';
import { zValidator } from '@hono/zod-validator';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { EPUBS_DIR, ensureDataDirs } from '../data-paths.ts';
import { db } from '../db/client.ts';
import { items } from '../db/schema.ts';
import { type EpubMeta, InvalidEpubError, readEpubMeta } from '../epub-meta.ts';

const MAX_EPUB_BYTES = 200 * 1024 * 1024;

const library = new Hono();

library.get('/', async (c) => {
  const all = await db.select().from(items).orderBy(desc(items.importedAt));
  return c.json({ items: all });
});

library.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  return c.json({ item });
});

library.post('/import', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'expected multipart form data with a "file" field' }, 400);
  }
  if (file.size === 0) return c.json({ error: 'file is empty' }, 400);
  if (file.size > MAX_EPUB_BYTES) return c.json({ error: 'file is too large' }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  let meta: EpubMeta;
  try {
    meta = await readEpubMeta(bytes);
  } catch (err) {
    if (err instanceof InvalidEpubError) {
      return c.json({ error: `not a valid EPUB: ${err.message}` }, 422);
    }
    throw err;
  }

  ensureDataDirs();
  const id = crypto.randomUUID();
  const epubPath = path.join(EPUBS_DIR, `${id}.epub`);
  fs.writeFileSync(epubPath, bytes);

  const now = new Date();
  const fallbackTitle = file.name.replace(/\.epub$/i, '').trim();
  const [item] = await db
    .insert(items)
    .values({
      id,
      title: meta.title ?? (fallbackTitle.length > 0 ? fallbackTitle : null),
      author: meta.author,
      state: 'unread',
      epubPath,
      importedAt: now,
      updatedAt: now,
    })
    .returning();
  return c.json({ item }, 201);
});

const statePatchSchema = z.object({
  state: z.enum(['unread', 'reading', 'finished', 'dnf']),
});

library.patch('/:id/state', zValidator('json', statePatchSchema), async (c) => {
  const id = c.req.param('id');
  const { state } = c.req.valid('json');
  const [item] = await db
    .update(items)
    .set({ state, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning();
  if (!item) return c.json({ error: 'not found' }, 404);
  return c.json({ item });
});

export default library;
