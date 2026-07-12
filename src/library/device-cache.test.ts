import { describe, expect, test } from 'bun:test';
import { DeviceCacheTransport } from './device-cache.ts';
import { MemoryDeviceStore } from './device-store.ts';
import type { LibraryTransport } from './transport.ts';
import { MemoryTransport } from './transports/memory.ts';
import { INDEX_FILENAME } from './types.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

/** A transport whose network can be cut. */
class FlakyTransport implements LibraryTransport {
  readonly inner = new MemoryTransport();
  offline = false;
  reads = 0;

  async read(path: string): Promise<Uint8Array | null> {
    if (this.offline) throw new TypeError('network unreachable');
    this.reads++;
    return this.inner.read(path);
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    if (this.offline) throw new TypeError('network unreachable');
    return this.inner.write(path, bytes);
  }
}

function indexJson(books: { id: string; dir: string }[], onDeck: string[]): string {
  return JSON.stringify({
    schema: 1,
    updatedAt: '2026-07-12T00:00:00Z',
    books: books.map((b) => ({ ...b, title: b.id })),
    onDeck,
  });
}

async function seeded(): Promise<{
  remote: FlakyTransport;
  store: MemoryDeviceStore;
  cache: DeviceCacheTransport;
}> {
  const remote = new FlakyTransport();
  await remote.write(
    INDEX_FILENAME,
    enc(
      indexJson(
        [
          { id: 'aaa', dir: 'books/alpha-aaa' },
          { id: 'bbb', dir: 'books/beta-bbb' },
          { id: 'ccc', dir: 'books/gamma-ccc' },
        ],
        ['aaa', 'bbb'],
      ),
    ),
  );
  for (const dir of ['books/alpha-aaa', 'books/beta-bbb', 'books/gamma-ccc']) {
    await remote.write(`${dir}/book.epub`, enc(`epub bytes of ${dir}`));
    await remote.write(`${dir}/book.json`, enc(`{"sidecar":"${dir}"}`));
  }
  const store = new MemoryDeviceStore();
  return { remote, store, cache: new DeviceCacheTransport(remote, store) };
}

describe('DeviceCacheTransport', () => {
  test('syncCachePolicy caches on-deck books and the index', async () => {
    const { store, cache } = await seeded();
    await cache.syncCachePolicy();
    expect(await store.keys()).toEqual([
      'books/alpha-aaa/book.epub',
      'books/alpha-aaa/book.json',
      'books/beta-bbb/book.epub',
      'books/beta-bbb/book.json',
      INDEX_FILENAME,
    ]);
  });

  test('epub reads are cache-first: no network after cached', async () => {
    const { remote, cache } = await seeded();
    await cache.syncCachePolicy();
    remote.offline = true;
    expect(dec(await cache.read('books/alpha-aaa/book.epub'))).toBe(
      'epub bytes of books/alpha-aaa',
    );
  });

  test('json reads are network-first, cache is the offline fallback', async () => {
    const { remote, cache } = await seeded();
    await cache.syncCachePolicy();
    await remote.write('books/alpha-aaa/book.json', enc('{"sidecar":"fresh"}'));
    expect(dec(await cache.read('books/alpha-aaa/book.json'))).toBe('{"sidecar":"fresh"}');
    remote.offline = true;
    // The fresh copy was cached on the way through.
    expect(dec(await cache.read('books/alpha-aaa/book.json'))).toBe('{"sidecar":"fresh"}');
    expect(dec(await cache.read(INDEX_FILENAME))).toContain('"onDeck"');
  });

  test('books outside the desired set are not cached by reads', async () => {
    const { store, cache } = await seeded();
    await cache.syncCachePolicy();
    await cache.read('books/gamma-ccc/book.epub');
    await cache.read('books/gamma-ccc/book.json');
    expect((await store.keys()).some((k) => k.includes('gamma'))).toBe(false);
  });

  test('pin makes the open book fully local and survives a new instance', async () => {
    const { remote, store, cache } = await seeded();
    await cache.pin('books/gamma-ccc');
    // The open flow's own reads land the book in the cache.
    await cache.read('books/gamma-ccc/book.epub');
    await cache.read('books/gamma-ccc/book.json');
    remote.offline = true;
    expect(dec(await cache.read('books/gamma-ccc/book.epub'))).toBe(
      'epub bytes of books/gamma-ccc',
    );
    // A reload constructs a fresh transport over the same store.
    const reloaded = new DeviceCacheTransport(remote, store);
    expect(dec(await reloaded.read('books/gamma-ccc/book.json'))).toBe(
      '{"sidecar":"books/gamma-ccc"}',
    );
  });

  test('sweep evicts books that left the deck, keeps the pinned book', async () => {
    const { remote, store, cache } = await seeded();
    await cache.syncCachePolicy();
    await cache.pin('books/gamma-ccc');
    // bbb leaves the deck.
    await remote.write(
      INDEX_FILENAME,
      enc(
        indexJson(
          [
            { id: 'aaa', dir: 'books/alpha-aaa' },
            { id: 'bbb', dir: 'books/beta-bbb' },
            { id: 'ccc', dir: 'books/gamma-ccc' },
          ],
          ['aaa'],
        ),
      ),
    );
    await cache.syncCachePolicy();
    const keys = await store.keys();
    expect(keys.some((k) => k.includes('beta-bbb'))).toBe(false);
    expect(keys.some((k) => k.includes('alpha-aaa'))).toBe(true);
    expect(keys.some((k) => k.includes('gamma-ccc'))).toBe(true);
    expect(keys).toContain(INDEX_FILENAME);
  });

  test('writes go through and write-through for desired books', async () => {
    const { remote, store, cache } = await seeded();
    await cache.syncCachePolicy();
    await cache.write('books/alpha-aaa/book.json', enc('{"sidecar":"moved"}'));
    expect(dec(await remote.inner.read('books/alpha-aaa/book.json'))).toBe('{"sidecar":"moved"}');
    expect(dec(await store.get('books/alpha-aaa/book.json'))).toBe('{"sidecar":"moved"}');
    // A write to an unreachable transport still fails; queueing is the next layer.
    remote.offline = true;
    expect(cache.write('books/alpha-aaa/book.json', enc('{}'))).rejects.toThrow();
  });

  test('offline boot: cached index still teaches the deck, reads stay local', async () => {
    const { remote, store, cache } = await seeded();
    await cache.syncCachePolicy();
    remote.offline = true;
    const reloaded = new DeviceCacheTransport(remote, store);
    await reloaded.syncCachePolicy();
    expect(dec(await reloaded.read(INDEX_FILENAME))).toContain('alpha-aaa');
    expect(dec(await reloaded.read('books/beta-bbb/book.epub'))).toBe(
      'epub bytes of books/beta-bbb',
    );
    // The sweep ran against cached knowledge and kept the deck.
    expect((await store.keys()).some((k) => k.includes('alpha-aaa'))).toBe(true);
  });
});
