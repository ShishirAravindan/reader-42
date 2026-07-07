import { beforeAll, describe, expect, test } from 'bun:test';
import { fixtureBytes } from './setup.ts';

import { readEpubText } from '../src/epub-text.ts';

let app: import('hono').Hono;
let itemId: string;

beforeAll(async () => {
  ({ app } = await import('../src/index.ts'));
  const form = new FormData();
  form.append('file', new File([fixtureBytes()], 'search-fixture.epub'));
  const res = await app.request('/library/import', { method: 'POST', body: form });
  ({
    item: { id: itemId },
  } = (await res.json()) as { item: { id: string } });
});

describe('readEpubText', () => {
  test('extracts spine text with chapter titles', async () => {
    const chapters = await readEpubText(fixtureBytes());
    expect(chapters.length).toBe(3);
    expect(chapters[0]?.title).toBe('Prologue');
    expect(chapters[1]?.text).toContain('Passage 12');
  });
});

describe('GET /library/search', () => {
  test('finds full-text matches with snippets', async () => {
    const res = await app.request('/library/search?q=patient');
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as {
      results: { item: { id: string }; matches: { chapter: number; snippet: string }[] }[];
    };
    const hit = results.find((r) => r.item.id === itemId);
    expect(hit).toBeDefined();
    expect(hit?.matches[0]?.chapter).toBe(1);
    expect(hit?.matches[0]?.snippet).toContain('«patient»');
  });

  test('empty query returns no results', async () => {
    const res = await app.request('/library/search?q=');
    const { results } = (await res.json()) as { results: unknown[] };
    expect(results).toEqual([]);
  });

  test('FTS syntax characters are treated as literals, not operators', async () => {
    const res = await app.request(`/library/search?q=${encodeURIComponent('patient" OR *')}`);
    expect(res.status).toBe(200);
  });
});

describe('progress and sessions', () => {
  test('PATCH /library/:id/progress stores the fraction', async () => {
    const res = await app.request(`/library/${itemId}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: 0.42 }),
    });
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: { progress: number } };
    expect(item.progress).toBeCloseTo(0.42);
  });

  test('PATCH progress rejects out-of-range values', async () => {
    const res = await app.request(`/library/${itemId}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress: 1.5 }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /library/:id/session accumulates into totalSeconds', async () => {
    for (const seconds of [120, 300]) {
      const res = await app.request(`/library/${itemId}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seconds }),
      });
      expect(res.status).toBe(201);
    }
    const res = await app.request('/library');
    const { items } = (await res.json()) as {
      items: { id: string; totalSeconds: number; progress: number }[];
    };
    const item = items.find((i) => i.id === itemId);
    expect(item?.totalSeconds).toBe(420);
    expect(item?.progress).toBeCloseTo(0.42);
  });
});
