import { describe, expect, test } from 'bun:test';
import { Library } from './store.ts';
import { MemoryTransport } from './transports/memory.ts';
import type { BookSidecar } from './types.ts';

const clock = () => '2026-07-12T00:00:00.000Z';
const epub = (content: string) => new TextEncoder().encode(content);

describe('Library', () => {
  test('opens empty on a blank transport', async () => {
    const lib = await Library.open(new MemoryTransport(), clock);
    expect(lib.index().books).toEqual([]);
  });

  test('import writes epub, sidecar, and index at contract paths', async () => {
    const t = new MemoryTransport();
    const lib = await Library.open(t, clock);
    const { sidecar, duplicate } = await lib.importBook(epub('bytes of a book'), {
      title: 'A Book',
      author: 'Someone',
    });
    expect(duplicate).toBe(false);
    expect(sidecar.state).toBe('unread');
    const dir = `books/a-book-${sidecar.id}`;
    expect(t.paths()).toEqual([`${dir}/book.epub`, `${dir}/book.json`, 'library.json']);
  });

  test('same bytes import as the same book, no twin', async () => {
    const t = new MemoryTransport();
    const lib = await Library.open(t, clock);
    const first = await lib.importBook(epub('identical'), { title: 'One', author: null });
    const second = await lib.importBook(epub('identical'), { title: 'One Again', author: null });
    expect(second.duplicate).toBe(true);
    expect(second.sidecar.id).toBe(first.sidecar.id);
    expect(lib.index().books).toHaveLength(1);
  });

  test('a reopened library sees what was imported', async () => {
    const t = new MemoryTransport();
    const lib = await Library.open(t, clock);
    const { sidecar } = await lib.importBook(epub('persisted'), { title: 'Kept', author: null });

    const reopened = await Library.open(t, clock);
    expect(reopened.index().books.map((b) => b.id)).toEqual([sidecar.id]);
    expect((await reopened.readSidecar(sidecar.id))?.title).toBe('Kept');
    expect(await reopened.readEpub(sidecar.id)).toEqual(epub('persisted'));
  });

  test('saveSidecar round-trips updated reading state', async () => {
    const t = new MemoryTransport();
    const lib = await Library.open(t, clock);
    const { sidecar } = await lib.importBook(epub('progressing'), { title: 'P', author: null });

    await lib.saveSidecar({
      ...sidecar,
      state: 'reading',
      progress: 0.5,
      position: { chapter: 2, anchor: { path: [4], ratio: 0.1 }, updatedAt: clock() },
    });
    const read = await lib.readSidecar(sidecar.id);
    expect(read?.state).toBe('reading');
    expect(read?.position?.anchor?.path).toEqual([4]);
  });

  test('saveSidecar for an unknown book throws', async () => {
    const lib = await Library.open(new MemoryTransport(), clock);
    const orphan: BookSidecar = {
      schema: 1,
      id: 'nope00000000',
      title: 'Orphan',
      author: null,
      addedAt: clock(),
      state: 'unread',
      stateChangedAt: clock(),
      progress: 0,
      position: null,
      highlights: [],
      sessions: [],
    };
    expect(lib.saveSidecar(orphan)).rejects.toThrow('unknown book');
  });

  test('sidecar files are human-readable json', async () => {
    const t = new MemoryTransport();
    const lib = await Library.open(t, clock);
    const { sidecar } = await lib.importBook(epub('pretty'), { title: 'Pretty', author: null });
    const raw = new TextDecoder().decode(
      (await t.read(`books/pretty-${sidecar.id}/book.json`)) ?? new Uint8Array(),
    );
    expect(raw).toContain('\n  "title": "Pretty"');
    expect(raw.endsWith('\n')).toBe(true);
  });
});
