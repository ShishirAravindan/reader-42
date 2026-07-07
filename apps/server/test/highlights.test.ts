import { beforeAll, describe, expect, test } from 'bun:test';
import { fixtureBytes } from './setup.ts';

let app: import('hono').Hono;
let itemId: string;
let highlightId: string;

beforeAll(async () => {
  ({ app } = await import('../src/index.ts'));
  const form = new FormData();
  form.append('file', new File([fixtureBytes()], 'highlights-fixture.epub'));
  const res = await app.request('/library/import', { method: 'POST', body: form });
  ({
    item: { id: itemId },
  } = (await res.json()) as { item: { id: string } });
});

const draft = {
  chapter: 1,
  startPath: [1],
  startOffset: 0,
  endPath: [1],
  endOffset: 42,
  text: 'Ink, in its proper element, is patient.',
  note: null,
};

describe('highlights CRUD', () => {
  test('POST creates a highlight', async () => {
    const res = await app.request(`/library/${itemId}/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    expect(res.status).toBe(201);
    const { highlight } = (await res.json()) as {
      highlight: { id: string; startPath: number[] };
    };
    expect(highlight.startPath).toEqual([1]);
    highlightId = highlight.id;
  });

  test('GET lists highlights for the item', async () => {
    const res = await app.request(`/library/${itemId}/highlights`);
    expect(res.status).toBe(200);
    const { highlights } = (await res.json()) as { highlights: { id: string }[] };
    expect(highlights.some((h) => h.id === highlightId)).toBe(true);
  });

  test('PATCH sets a note', async () => {
    const res = await app.request(`/library/${itemId}/highlights/${highlightId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'ink is patient — use in essay' }),
    });
    expect(res.status).toBe(200);
    const { highlight } = (await res.json()) as { highlight: { note: string } };
    expect(highlight.note).toContain('essay');
  });

  test('logseq.md export carries text, note, and deep link', async () => {
    const res = await app.request(`/library/${itemId}/logseq.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('markdown');
    const md = await res.text();
    expect(md).toContain('[[The Test Volume]]');
    expect(md).toContain('"Ink, in its proper element, is patient."');
    expect(md).toContain('note:: ink is patient — use in essay');
    expect(md).toContain('link:: ');
    expect(md).toContain(`/#/book/${itemId}/hl/${highlightId}`);
  });

  test('DELETE removes the highlight', async () => {
    const res = await app.request(`/library/${itemId}/highlights/${highlightId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const list = await app.request(`/library/${itemId}/highlights`);
    const { highlights } = (await list.json()) as { highlights: unknown[] };
    expect(highlights.length).toBe(0);
  });

  test('POST 404s for a missing item', async () => {
    const res = await app.request('/library/no-such/highlights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    expect(res.status).toBe(404);
  });
});
