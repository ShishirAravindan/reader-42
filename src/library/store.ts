// The library, as the app sees it: typed operations over a transport.
//
// This is the only module that knows both the file contract (types, parse)
// and the storage seam (transport). Everything above it deals in books;
// everything below it deals in bytes.

import { bookDir, bookIdFromBytes } from './identity.ts';
import { parseIndex, parseSidecar } from './parse.ts';
import { type LibraryTransport, readJson, writeJson } from './transport.ts';
import {
  type BookSidecar,
  EPUB_FILENAME,
  INDEX_FILENAME,
  type LibraryIndex,
  SIDECAR_FILENAME,
} from './types.ts';

export interface ImportMeta {
  title: string;
  author: string | null;
}

export interface ImportResult {
  sidecar: BookSidecar;
  /** True when these exact bytes were already on the shelf. */
  duplicate: boolean;
}

type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

export class Library {
  private readonly transport: LibraryTransport;
  private readonly now: Clock;
  private current: LibraryIndex;
  // A write from this device is the newest known state for that book, full
  // stop ("writes queue and flush when online, latest timestamp wins" —
  // docs/decisions.md). Caching it here means a readSidecar() that lands
  // right after a fire-and-forget saveSidecar() never races the transport
  // for bytes we already know. Scoped to this Library instance's lifetime:
  // no TTL, no invalidation — a fresh instance (reload, reopen) starts empty
  // and reads through, same as today.
  private readonly sidecarCache = new Map<string, BookSidecar>();

  private constructor(transport: LibraryTransport, index: LibraryIndex, now: Clock) {
    this.transport = transport;
    this.current = index;
    this.now = now;
  }

  /** Open a library at the transport's root. A missing or mangled index is an empty library. */
  static async open(transport: LibraryTransport, now: Clock = systemClock): Promise<Library> {
    const index = parseIndex(await readJson(transport, INDEX_FILENAME), now());
    return new Library(transport, index, now);
  }

  index(): LibraryIndex {
    return this.current;
  }

  /**
   * Import an EPUB. Identity is the content hash, so importing the same bytes
   * twice returns the existing book instead of growing a twin.
   */
  async importBook(bytes: Uint8Array, meta: ImportMeta): Promise<ImportResult> {
    const id = await bookIdFromBytes(bytes);
    const existing = this.current.books.find((b) => b.id === id);
    if (existing) {
      const sidecar = await this.readSidecar(id);
      if (sidecar) return { sidecar, duplicate: true };
      // Index entry without a sidecar: heal it by falling through to a fresh write.
    }

    const dir = existing?.dir ?? bookDir(meta.title, id);
    const nowIso = this.now();
    const sidecar: BookSidecar = {
      schema: 1,
      id,
      title: meta.title,
      author: meta.author,
      addedAt: nowIso,
      state: 'unread',
      stateChangedAt: nowIso,
      progress: 0,
      position: null,
      highlights: [],
      sessions: [],
    };

    await this.transport.write(`${dir}/${EPUB_FILENAME}`, bytes);
    await this.writeSidecar(dir, sidecar);
    if (!existing) {
      this.current = {
        ...this.current,
        books: [...this.current.books, { id, dir, title: meta.title }],
      };
      await this.saveIndex();
    }
    return { sidecar, duplicate: false };
  }

  async readSidecar(id: string): Promise<BookSidecar | null> {
    const entry = this.current.books.find((b) => b.id === id);
    if (!entry) return null;
    const cached = this.sidecarCache.get(id);
    if (cached) return cached;
    return parseSidecar(
      await readJson(this.transport, `${entry.dir}/${SIDECAR_FILENAME}`),
      this.now(),
    );
  }

  async saveSidecar(sidecar: BookSidecar): Promise<void> {
    const entry = this.current.books.find((b) => b.id === sidecar.id);
    if (!entry) throw new Error(`library: unknown book ${sidecar.id}`);
    await this.writeSidecar(entry.dir, sidecar);
  }

  async readEpub(id: string): Promise<Uint8Array | null> {
    const entry = this.current.books.find((b) => b.id === id);
    if (!entry) return null;
    return this.transport.read(`${entry.dir}/${EPUB_FILENAME}`);
  }

  private async writeSidecar(dir: string, sidecar: BookSidecar): Promise<void> {
    // Populate before awaiting the transport: a reader that races this write
    // with an immediate read (fire-and-forget saveSidecar, then navigate back
    // to the shelf) sees the fresh sidecar synchronously, not whatever the
    // transport had a moment ago.
    this.sidecarCache.set(sidecar.id, sidecar);
    await writeJson(this.transport, `${dir}/${SIDECAR_FILENAME}`, sidecar);
  }

  private async saveIndex(): Promise<void> {
    this.current = { ...this.current, updatedAt: this.now() };
    await writeJson(this.transport, INDEX_FILENAME, this.current);
  }
}
