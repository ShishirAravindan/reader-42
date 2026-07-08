import fs from 'node:fs';
import path from 'node:path';
import { zValidator } from '@hono/zod-validator';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { EPUBS_DIR, ensureDataDirs } from '../data-paths.ts';
import { db } from '../db/client.ts';
import { highlights as highlightsTable, items, readingSessions } from '../db/schema.ts';
import { type EpubMeta, InvalidEpubError, readEpubMeta } from '../epub-meta.ts';
import { readEpubText } from '../epub-text.ts';
import highlightRoutes from './highlights.ts';

const MAX_EPUB_BYTES = 200 * 1024 * 1024;

const library = new Hono();

function parsePosition(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

library.get('/', async (c) => {
  const all = await db
    .select({
      id: items.id,
      title: items.title,
      author: items.author,
      state: items.state,
      progress: items.progress,
      position: items.position,
      importedAt: items.importedAt,
      updatedAt: items.updatedAt,
      totalSeconds: sql<number>`coalesce(sum(${readingSessions.seconds}), 0)`,
    })
    .from(items)
    .leftJoin(readingSessions, eq(readingSessions.itemId, items.id))
    .groupBy(items.id)
    .orderBy(desc(items.importedAt));
  return c.json({
    items: all.map((item) => ({ ...item, position: parsePosition(item.position) })),
  });
});

library.get('/search', async (c) => {
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length === 0) return c.json({ results: [] });
  // Quote each term so FTS query syntax characters can't break the MATCH.
  const match = q
    .split(/\s+/)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' ');
  const rows = (await db.all(sql`
    SELECT item_id AS itemId,
           chapter,
           title AS chapterTitle,
           snippet(items_fts, 3, '«', '»', '…', 12) AS snippet
    FROM items_fts
    WHERE items_fts MATCH ${match}
    ORDER BY rank
    LIMIT 60
  `)) as { itemId: string; chapter: number; chapterTitle: string | null; snippet: string }[];

  const ids = [...new Set(rows.map((row) => row.itemId))];
  const books = ids.length > 0 ? await db.select().from(items).where(inArray(items.id, ids)) : [];
  const byId = new Map(books.map((book) => [book.id, book]));
  const results = ids
    .map((id) => ({
      item: byId.get(id),
      matches: rows
        .filter((row) => row.itemId === id)
        .map(({ chapter, chapterTitle, snippet }) => ({ chapter, chapterTitle, snippet })),
    }))
    .filter((entry) => entry.item);
  return c.json({ results });
});

library.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  return c.json({ item: { ...item, position: parsePosition(item.position) } });
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

  // Same bytes already on the shelf: hand back the existing book instead of
  // silently growing a twin.
  const contentHash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const [existing] = await db
    .select()
    .from(items)
    .where(eq(items.contentHash, contentHash))
    .limit(1);
  if (existing) {
    return c.json({
      item: { ...existing, position: parsePosition(existing.position) },
      duplicate: true,
    });
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
      contentHash,
      importedAt: now,
      updatedAt: now,
    })
    .returning();

  // Index spine text for search. Extraction failures shouldn't fail the
  // import — a book you can't search is better than a book you can't add.
  try {
    const chapters = await readEpubText(bytes);
    for (const chapter of chapters) {
      if (chapter.text.length === 0) continue;
      await db.run(
        sql`INSERT INTO items_fts (item_id, chapter, title, text)
            VALUES (${id}, ${chapter.index}, ${chapter.title}, ${chapter.text})`,
      );
    }
  } catch (err) {
    console.error(`[import] FTS indexing failed for ${id}:`, err);
  }

  return c.json({ item }, 201);
});

const progressSchema = z.object({
  progress: z.number().min(0).max(1),
  position: z
    .object({
      chapter: z.number().int().min(0),
      scroll: z.number().min(0),
      anchor: z
        .object({
          path: z.array(z.number().int().min(0)).max(32),
          ratio: z.number(),
        })
        .optional(),
    })
    .optional(),
});

library.patch('/:id/progress', zValidator('json', progressSchema), async (c) => {
  const id = c.req.param('id');
  const { progress, position } = c.req.valid('json');
  const [item] = await db
    .update(items)
    .set({ progress, ...(position ? { position: JSON.stringify(position) } : {}) })
    .where(eq(items.id, id))
    .returning();
  if (!item) return c.json({ error: 'not found' }, 404);
  return c.json({ item: { ...item, position: parsePosition(item.position) } });
});

// The Logseq off-ramp: one markdown outline per book, thin by design —
// highlight text, note, chapter, and a deep link back into the reader.
library.get('/:id/logseq.md', async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  const rows = await db
    .select()
    .from(highlightsTable)
    .where(eq(highlightsTable.itemId, id))
    .orderBy(highlightsTable.chapter, highlightsTable.startOffset);
  const origin = new URL(c.req.url).origin;
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `- [[${item.title ?? 'Untitled'}]]${item.author ? ` by ${item.author}` : ''} #reader-42`,
    `  exported:: ${today}`,
  ];
  for (const hl of rows) {
    lines.push(`\t- "${hl.text.replace(/\s+/g, ' ').trim()}"`);
    lines.push(`\t  chapter:: ${hl.chapter + 1}`);
    lines.push(`\t  link:: ${origin}/#/book/${id}/hl/${hl.id}`);
    if (hl.note) lines.push(`\t  note:: ${hl.note.replace(/\s+/g, ' ').trim()}`);
  }
  return c.body(`${lines.join('\n')}\n`, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${(item.title ?? 'highlights').replace(/[^\w -]/g, '')}.md"`,
  });
});

library.route('/:id/highlights', highlightRoutes);

const sessionSchema = z.object({ seconds: z.number().int().min(1).max(86400) });

library.post('/:id/session', zValidator('json', sessionSchema), async (c) => {
  const id = c.req.param('id');
  const [item] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!item) return c.json({ error: 'not found' }, 404);
  const { seconds } = c.req.valid('json');
  await db.insert(readingSessions).values({
    id: crypto.randomUUID(),
    itemId: id,
    seconds,
    endedAt: new Date(),
  });
  return c.json({ ok: true }, 201);
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
