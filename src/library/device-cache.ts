// The on-device book cache: a transport decorator.
//
// Sits between the app and a remote transport (dev-http today, the drive
// client later) and keeps the books that matter fully local, per the vision:
// the current book and the on-deck queue live on the device, and reading
// never needs the network once a book is cached.
//
// Policy: the desired set is the pinned (last-opened) book plus every book
// in library.json's onDeck. The deck is learned passively — any index bytes
// that pass through a read or write refresh it — and enforced by
// syncCachePolicy(), which prefetches the desired books and sweeps the rest.
//
// Read strategy per kind:
//   .epub  — cache-first. The id is a content hash, so cached bytes are
//            immutable; a hit never needs revalidation.
//   .json  — network-first so another device's writes are seen promptly,
//            falling back to the cached copy when the transport is
//            unreachable. Fresh bytes for desired books are cached on the
//            way through.
//
// Writes go through to the transport and write-through into the cache for
// desired books, so an offline reload sees the latest position. A write to
// an unreachable transport still fails here; queueing is the next layer.

import type { DeviceStore } from './device-store.ts';
import { parseIndex } from './parse.ts';
import type { LibraryTransport } from './transport.ts';
import { EPUB_FILENAME, INDEX_FILENAME, SIDECAR_FILENAME } from './types.ts';

const PINNED_KEY = '~pinned';

function bookDirOf(path: string): string | null {
  const match = path.match(/^(books\/[^/]+)\//);
  return match?.[1] ?? null;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export class DeviceCacheTransport implements LibraryTransport {
  private readonly inner: LibraryTransport;
  private readonly store: DeviceStore;
  private deckDirs = new Set<string>();
  private pinnedDir: string | null = null;
  private pinnedLoaded = false;

  constructor(inner: LibraryTransport, store: DeviceStore) {
    this.inner = inner;
    this.store = store;
  }

  async read(path: string): Promise<Uint8Array | null> {
    if (path.endsWith('.epub')) {
      const cached = await this.store.get(path);
      if (cached) return cached;
      const bytes = await this.tryInnerRead(path);
      if (bytes && (await this.isDesired(path))) await this.store.put(path, bytes);
      return bytes;
    }

    let bytes: Uint8Array | null = null;
    let unreachable = false;
    try {
      bytes = await this.inner.read(path);
    } catch {
      unreachable = true;
    }
    if (unreachable) {
      const cached = await this.store.get(path);
      if (cached) this.learnDeck(path, cached);
      return cached;
    }
    if (bytes) {
      this.learnDeck(path, bytes);
      if (await this.isDesired(path)) await this.store.put(path, bytes);
    }
    return bytes;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.learnDeck(path, bytes);
    if (await this.isDesired(path)) await this.store.put(path, bytes);
    await this.inner.write(path, bytes);
  }

  /**
   * Pin the book the reader has open: it joins the desired set immediately
   * (synchronously, so the open flow's own reads populate the cache without
   * a second fetch) and survives reloads.
   */
  async pin(dir: string): Promise<void> {
    this.pinnedDir = dir;
    this.pinnedLoaded = true;
    await this.store.put(PINNED_KEY, new TextEncoder().encode(dir));
  }

  /**
   * Bring the cache to policy: prefetch every desired book, then sweep
   * cached books that are neither pinned nor on deck. Unreachable-network
   * failures skip the prefetch and never block the sweep of known data.
   */
  async syncCachePolicy(): Promise<void> {
    await this.read(INDEX_FILENAME); // refreshes deckDirs, caches the index
    const desired = await this.desiredDirs();
    for (const dir of desired) {
      await this.ensureCached(dir);
    }
    for (const key of await this.store.keys()) {
      const dir = bookDirOf(key);
      if (dir && !desired.has(dir)) await this.store.delete(key);
    }
  }

  private async ensureCached(dir: string): Promise<void> {
    try {
      await this.read(`${dir}/${SIDECAR_FILENAME}`);
      await this.read(`${dir}/${EPUB_FILENAME}`);
    } catch {
      // Unreachable transport: the next sync will fill the gap.
    }
  }

  private async tryInnerRead(path: string): Promise<Uint8Array | null> {
    try {
      return await this.inner.read(path);
    } catch {
      return null;
    }
  }

  /** Any index bytes passing through teach the cache the current deck. */
  private learnDeck(path: string, bytes: Uint8Array): void {
    if (path !== INDEX_FILENAME) return;
    let value: unknown;
    try {
      value = JSON.parse(decodeText(bytes));
    } catch {
      return;
    }
    const index = parseIndex(value, new Date().toISOString());
    this.deckDirs = new Set(
      index.onDeck
        .map((id) => index.books.find((b) => b.id === id)?.dir)
        .filter((dir): dir is string => dir !== undefined),
    );
  }

  private async isDesired(path: string): Promise<boolean> {
    if (path === INDEX_FILENAME) return true;
    const dir = bookDirOf(path);
    if (!dir) return false;
    return (await this.desiredDirs()).has(dir);
  }

  private async desiredDirs(): Promise<Set<string>> {
    if (!this.pinnedLoaded) {
      const bytes = await this.store.get(PINNED_KEY);
      this.pinnedDir = bytes ? decodeText(bytes) : null;
      this.pinnedLoaded = true;
    }
    const dirs = new Set(this.deckDirs);
    if (this.pinnedDir) dirs.add(this.pinnedDir);
    return dirs;
  }
}
