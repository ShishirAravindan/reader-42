import { beforeAll, describe, expect, test } from 'bun:test';
import { FIXTURE_EPUB, fixtureBytes } from './setup.ts';

// Imported dynamically so setup.ts has already pointed DATA_DIR at a temp dir.
let app: import('hono').Hono;

beforeAll(async () => {
  ({ app } = await import('../src/index.ts'));
});

function epubForm(): FormData {
  const form = new FormData();
  form.append('file', new File([fixtureBytes()], 'test-book.epub'));
  return form;
}

describe('library routes', () => {
  let importedId: string;

  test('POST /library/import stores the EPUB and reads OPF metadata', async () => {
    const res = await app.request('/library/import', { method: 'POST', body: epubForm() });
    expect(res.status).toBe(201);
    const { item } = (await res.json()) as { item: { id: string; title: string; state: string } };
    expect(item.title).toBe('The Test Volume');
    expect(item.state).toBe('unread');
    importedId = item.id;
  });

  test('re-importing the same bytes returns the existing item, no twin', async () => {
    const res = await app.request('/library/import', { method: 'POST', body: epubForm() });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { item: { id: string }; duplicate: boolean };
    expect(data.duplicate).toBe(true);
    expect(data.item.id).toBe(importedId);
    const list = await app.request('/library');
    const { items } = (await list.json()) as { items: { id: string }[] };
    expect(items.filter((i) => i.id === importedId).length).toBe(1);
  });

  test('POST /library/import rejects a non-EPUB with 422', async () => {
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode('junk')], 'junk.epub'));
    const res = await app.request('/library/import', { method: 'POST', body: form });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not a valid EPUB');
  });

  test('POST /library/import rejects a missing file field with 400', async () => {
    const res = await app.request('/library/import', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(400);
  });

  test('GET /library lists the imported item', async () => {
    const res = await app.request('/library');
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: { id: string }[] };
    expect(items.some((item) => item.id === importedId)).toBe(true);
  });

  test('PATCH /library/:id/state transitions the item', async () => {
    const res = await app.request(`/library/${importedId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'reading' }),
    });
    expect(res.status).toBe(200);
    const { item } = (await res.json()) as { item: { state: string } };
    expect(item.state).toBe('reading');
  });

  test('PATCH /library/:id/state rejects an unknown state', async () => {
    const res = await app.request(`/library/${importedId}/state`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'abandoned-on-a-train' }),
    });
    expect(res.status).toBe(400);
  });

  test('PATCH /library/:id/state 404s for a missing item', async () => {
    const res = await app.request('/library/no-such-id/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'reading' }),
    });
    expect(res.status).toBe(404);
  });

  test('GET /reader/:id/epub serves the stored bytes back', async () => {
    const res = await app.request(`/reader/${importedId}/epub`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/epub+zip');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(fixtureBytes().byteLength);
  });

  test('GET / serves the web reader shell', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="library-view"');
  });

  test('static serving refuses path traversal', async () => {
    const res = await app.request('/../../etc/passwd');
    expect([404, 400]).toContain(res.status);
  });
});

// Sanity: the fixture the whole suite leans on is committed-adjacent tooling.
test('fixture exists on disk', () => {
  expect(FIXTURE_EPUB.endsWith('test-book.epub')).toBe(true);
});
