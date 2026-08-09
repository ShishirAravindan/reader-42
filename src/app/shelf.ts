// Shelf row loading: fetching one sidecar per book, for as many books as are
// on the shelf. On a remote transport (Drive) each sidecar read costs several
// network round trips, so this fetches them all concurrently rather than
// serializing N round trips one book at a time. A single book's read failing
// degrades that book to its index title, the same fallback a missing sidecar
// already gets — it never blanks the whole shelf.

import type { BookSidecar, LibraryEntry } from '../library/types.ts';

export interface ShelfRow {
  id: string;
  title: string;
  meta: string;
}

export async function loadShelfRows(
  entries: LibraryEntry[],
  readSidecar: (id: string) => Promise<BookSidecar | null>,
): Promise<ShelfRow[]> {
  const sidecars = await Promise.all(
    entries.map((entry) => readSidecar(entry.id).catch(() => null)),
  );
  return entries.map((entry, i) => {
    const sidecar = sidecars[i] ?? null;
    return {
      id: entry.id,
      title: sidecar?.title ?? entry.title,
      meta: shelfMeta(sidecar),
    };
  });
}

export function shelfMeta(sidecar: BookSidecar | null): string {
  if (!sidecar) return '';
  const bits: string[] = [];
  if (sidecar.author) bits.push(sidecar.author);
  if (sidecar.state === 'reading') bits.push(`${Math.round(sidecar.progress * 100)}%`);
  else if (sidecar.state !== 'unread') bits.push(sidecar.state);
  return bits.join(' · ');
}
