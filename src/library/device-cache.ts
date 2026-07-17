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
// desired books, so an offline reload sees the latest position. When the
// transport is unreachable, the write still succeeds: the bytes land in the
// device store and the path joins a durable queue, flushed when the network
// returns. A flush never clobbers another device's work — queued sidecars
// and the index merge field-wise (merge.ts) against whatever is remote by
// then; epub bytes are content-addressed and replay as-is.

import type { DeviceStore } from './device-store.ts';
import { mergeIndexes, mergeSidecars } from './merge.ts';
import { parseIndex, parseSidecar } from './parse.ts';
import type { LibraryTransport } from './transport.ts';
import { EPUB_FILENAME, INDEX_FILENAME, SIDECAR_FILENAME } from './types.ts';

const PINNED_KEY = '~pinned';
const PENDING_KEY = '~pending';

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
  private pending: Set<string> | null = null;
  private flushing = false;

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

    // A queued local write is the truth for its path until it flushes:
    // never let a stale remote copy shadow it.
    if ((await this.pendingPaths()).has(path)) {
      await this.flush();
      if ((await this.pendingPaths()).has(path)) return this.store.get(path);
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
    try {
      await this.inner.write(path, bytes);
    } catch {
      // Unreachable transport: the write is durable locally and queued.
      // Only the latest bytes per path matter — a sidecar write is a whole
      // snapshot — so the queue is a set of paths over the cached bytes.
      await this.store.put(path, bytes);
      await this.addPending(path);
      return;
    }
    // The transport is reachable again; drain anything queued while it wasn't.
    if ((await this.pendingPaths()).size > 0) await this.flush();
  }

  /**
   * Replay queued writes against the transport, oldest path first. Sidecars
   * and the index merge field-wise with the current remote copy before
   * writing, so a flush reconciles rather than overwrites; the merged
   * result becomes the cached truth. Stops quietly at the first network
   * failure and retries on the next flush.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const path of [...(await this.pendingPaths())]) {
        const local = await this.store.get(path);
        if (local) {
          const out = await this.reconcile(path, local);
          await this.inner.write(path, out);
          await this.store.put(path, out);
          this.learnDeck(path, out);
        }
        await this.removePending(path);
      }
    } catch {
      // Still unreachable; the queue persists for the next attempt.
    } finally {
      this.flushing = false;
    }
  }

  /** Paths with queued writes; empty when the device is fully synced. */
  async pendingWrites(): Promise<string[]> {
    return [...(await this.pendingPaths())].sort();
  }

  /** Merge queued local bytes with the remote copy, per the file's kind. */
  private async reconcile(path: string, local: Uint8Array): Promise<Uint8Array> {
    const isSidecar = path.endsWith(`/${SIDECAR_FILENAME}`);
    const isIndex = path === INDEX_FILENAME;
    if (!isSidecar && !isIndex) return local; // epub bytes are content-addressed
    const remote = await this.inner.read(path); // throws when unreachable: flush aborts
    if (!remote) return local;
    try {
      const now = new Date().toISOString();
      const localValue = JSON.parse(decodeText(local));
      const remoteValue = JSON.parse(decodeText(remote));
      const merged = isIndex
        ? mergeIndexes(parseIndex(remoteValue, now), parseIndex(localValue, now))
        : mergeSidecars(
            requireSidecar(parseSidecar(remoteValue, now)),
            requireSidecar(parseSidecar(localValue, now)),
          );
      return new TextEncoder().encode(`${JSON.stringify(merged, null, 2)}\n`);
    } catch {
      // Unparseable or foreign data on either side: degrade to the local
      // snapshot rather than fail the flush.
      return local;
    }
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
   * Bring the device to policy: flush queued writes, prefetch every desired
   * book, then sweep cached books that are neither pinned nor on deck.
   * Unreachable-network failures skip the prefetch and never block the
   * sweep of known data; paths with queued writes are never swept.
   */
  async syncCachePolicy(): Promise<void> {
    await this.flush();
    await this.read(INDEX_FILENAME); // refreshes deckDirs, caches the index
    const desired = await this.desiredDirs();
    for (const dir of desired) {
      await this.ensureCached(dir);
    }
    const pending = await this.pendingPaths();
    for (const key of await this.store.keys()) {
      const dir = bookDirOf(key);
      if (dir && !desired.has(dir) && !pending.has(key)) await this.store.delete(key);
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

  // --- the durable write queue: a set of paths persisted in the store ---

  private async pendingPaths(): Promise<Set<string>> {
    if (this.pending) return this.pending;
    const bytes = await this.store.get(PENDING_KEY);
    let paths: string[] = [];
    if (bytes) {
      try {
        const value = JSON.parse(decodeText(bytes));
        if (Array.isArray(value)) paths = value.filter((p): p is string => typeof p === 'string');
      } catch {
        // A mangled queue degrades to empty; the cache still holds the bytes.
      }
    }
    this.pending = new Set(paths);
    return this.pending;
  }

  private async addPending(path: string): Promise<void> {
    const pending = await this.pendingPaths();
    pending.add(path);
    await this.persistPending(pending);
  }

  private async removePending(path: string): Promise<void> {
    const pending = await this.pendingPaths();
    pending.delete(path);
    await this.persistPending(pending);
  }

  private async persistPending(pending: Set<string>): Promise<void> {
    await this.store.put(PENDING_KEY, new TextEncoder().encode(JSON.stringify([...pending])));
  }
}

function requireSidecar<T>(value: T | null): T {
  if (!value) throw new Error('unparseable sidecar');
  return value;
}
