// A KOReader folder, read as the library.
//
// This is the inversion. The other direction — import an EPUB into
// books/<slug>/book.epub, write our own book.json, keep our own index — makes
// KOReader a data source feeding our reader. Here KOReader's own layout IS the
// library, and reader-42 adapts to it:
//
//     <library>/
//       Pride and Prejudice.epub
//       Pride and Prejudice.sdr/
//         metadata.epub.lua      ← place, progress, status, annotations
//
// There is no library.json, no book.json, no import step, no id of our own.
// A book appears on the shelf because the file is in the folder; everything
// known about it is what the device wrote. Drop a book in from any machine and
// it is there. Delete the app and the library is untouched.
//
// What reader-42 owns under this arrangement is the SHELF and the off-ramp —
// a record of engagement, and highlights out to a graph — which is exactly
// what KOReader's file browser is not and does not want to be.

import type { KoAnnotation } from './sdr.ts';
import { readSidecar } from './sdr.ts';

/** Reading lifecycle, derived from what the device recorded. */
export type ShelfState = 'unread' | 'reading' | 'finished' | 'dnf';

export interface ShelfBook {
  /** The EPUB's filename. The file IS the identity — no hash, no id. */
  file: string;
  /** The sidecar path, when the device has written one. */
  sidecar: string | null;
  title: string;
  author: string | null;
  state: ShelfState;
  /** 0..1, or null when the book has never been opened. */
  progress: number | null;
  /** Last time the device touched this book, when it says. */
  lastRead: string | null;
  annotations: KoAnnotation[];
}

/**
 * KOReader's `summary.status` onto a shelf state.
 *
 * "new" is a book it has seen and not started, which is our `unread`;
 * "abandoned" is exactly DNF and is the rarest and most useful of the four,
 * because it is the one a shelf usually refuses to represent honestly.
 * Progress is the fallback for a sidecar with no summary at all.
 */
export function shelfState(status: string | undefined, progress: number | null): ShelfState {
  switch (status) {
    case 'complete':
      return 'finished';
    case 'abandoned':
      return 'dnf';
    case 'reading':
      return 'reading';
    case 'new':
      return 'unread';
    default:
      if (progress === null) return 'unread';
      if (progress >= 0.999) return 'finished';
      return progress > 0 ? 'reading' : 'unread';
  }
}

/** `Foo.epub` → `Foo.sdr/metadata.epub.lua`, KOReader's own derivation. */
export function sidecarPathFor(epubFile: string): string {
  const base = epubFile.replace(/\.epub$/i, '');
  return `${base}.sdr/metadata.epub.lua`;
}

/** A readable title from a filename, for a book with no sidecar and no OPF. */
export function titleFromFile(epubFile: string): string {
  return epubFile.replace(/\.epub$/i, '').replace(/_/g, ' ');
}

/** How the caller reaches files; the shelf never assumes a filesystem. */
export interface FolderAccess {
  /** Every entry in the library folder, files and directories alike. */
  list(): Promise<string[]>;
  /** A file's text, or null when it is not there. */
  readText(path: string): Promise<string | null>;
}

/**
 * Read the folder into a shelf.
 *
 * A book with no sidecar is unread, not broken: that is a book dropped in and
 * never opened, which is the normal state of half a library. A sidecar that
 * will not parse is treated the same way rather than failing the shelf — one
 * bad file must never cost the whole collection.
 */
export async function readShelf(folder: FolderAccess): Promise<ShelfBook[]> {
  const entries = await folder.list();
  const epubs = entries.filter((name) => /\.epub$/i.test(name)).sort();

  const books: ShelfBook[] = [];
  for (const file of epubs) {
    const sidecarPath = sidecarPathFor(file);
    const source = await folder.readText(sidecarPath);

    if (source === null) {
      books.push({
        file,
        sidecar: null,
        title: titleFromFile(file),
        author: null,
        state: 'unread',
        progress: null,
        lastRead: null,
        annotations: [],
      });
      continue;
    }

    try {
      const sidecar = readSidecar(source);
      books.push({
        file,
        sidecar: sidecarPath,
        title: sidecar.title ?? titleFromFile(file),
        author: sidecar.author ?? null,
        state: shelfState(sidecar.status, sidecar.percentFinished),
        progress: sidecar.percentFinished,
        lastRead: lastTouched(sidecar.annotations),
        annotations: sidecar.annotations,
      });
    } catch {
      books.push({
        file,
        sidecar: sidecarPath,
        title: titleFromFile(file),
        author: null,
        state: 'unread',
        progress: null,
        lastRead: null,
        annotations: [],
      });
    }
  }
  return books;
}

/** The most recent annotation time, as a stand-in for "last read". KOReader
 * keeps real per-book statistics in its own database; the sidecar does not,
 * and inventing a time would be worse than showing none. */
function lastTouched(annotations: KoAnnotation[]): string | null {
  let latest: string | null = null;
  for (const annotation of annotations) {
    if (latest === null || annotation.createdAt > latest) latest = annotation.createdAt;
  }
  return latest;
}

/**
 * On deck: what to read next, capped.
 *
 * The cap is the product law (vision.md: friction asymmetry), not a display
 * limit — it is what keeps a library a record rather than an inbox. Books
 * already started come first, most recently touched first, then the untouched
 * ones in shelf order.
 */
export function onDeck(books: ShelfBook[], cap = 5): ShelfBook[] {
  const reading = books
    .filter((book) => book.state === 'reading')
    .sort((a, b) => (b.lastRead ?? '').localeCompare(a.lastRead ?? ''));
  const unread = books.filter((book) => book.state === 'unread');
  return [...reading, ...unread].slice(0, cap);
}

/** Every highlight in the library, newest first — the cross-book view that a
 * per-book file browser structurally cannot offer. */
export function allAnnotations(
  books: ShelfBook[],
): { book: ShelfBook; annotation: KoAnnotation }[] {
  const rows = books.flatMap((book) =>
    book.annotations.map((annotation) => ({ book, annotation })),
  );
  return rows.sort((a, b) => b.annotation.createdAt.localeCompare(a.annotation.createdAt));
}

/** Free-text search across highlights and notes: "where did I read about X?" */
export function searchAnnotations(
  rows: { book: ShelfBook; annotation: KoAnnotation }[],
  query: string,
): { book: ShelfBook; annotation: KoAnnotation }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(({ book, annotation }) =>
    [annotation.text, annotation.note ?? '', annotation.chapter ?? '', book.title]
      .join('\n')
      .toLowerCase()
      .includes(needle),
  );
}
