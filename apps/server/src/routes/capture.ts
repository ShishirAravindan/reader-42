import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { enqueueConvert } from '../convert/worker.ts';
import { db } from '../db/client.ts';
import { items } from '../db/schema.ts';

const capture = new Hono();

const captureUrlSchema = z.object({
  url: z.string().url(),
});

const captureUrlSeriesSchema = z.object({
  urls: z.array(z.string().url()).min(2),
  title: z.string().optional(),
});

function makeId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12);
}

capture.post('/url', zValidator('json', captureUrlSchema), async (c) => {
  const { url } = c.req.valid('json');
  const id = makeId();
  const now = new Date();

  await db.insert(items).values({
    id,
    sourceType: 'url',
    sourceRef: url,
    state: 'captured',
    capturedAt: now,
    updatedAt: now,
  });

  enqueueConvert(id).catch((err) => {
    console.error(`[capture] enqueue failed for ${id}:`, err);
  });

  return c.json({ id, state: 'captured' }, 202);
});

capture.post('/url-series', zValidator('json', captureUrlSeriesSchema), async (c) => {
  const { urls, title } = c.req.valid('json');
  const id = makeId();
  const now = new Date();

  await db.insert(items).values({
    id,
    sourceType: 'url_series',
    sourceRef: JSON.stringify(urls),
    title: title ?? null,
    state: 'captured',
    capturedAt: now,
    updatedAt: now,
  });

  enqueueConvert(id).catch((err) => {
    console.error(`[capture] enqueue failed for ${id}:`, err);
  });

  return c.json({ id, state: 'captured' }, 202);
});

export default capture;
