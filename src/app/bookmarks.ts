// Bookmarks (parity G1/G2): the corner gesture, the dog-ear ribbon, and the
// pure record arithmetic behind them.
//
// A bookmark is the page you marked, expressed as the same structural anchor
// a reading position uses, and it lives in the SYNCED sidecar (kickoff
// resolution 4) — place follows the reader across devices, taste does not.
// The pure helpers here are unit-tested; the ribbon below is proven by the
// demo scene, because "is this bookmark on the visible page" is geometry.

import type { Bookmark } from '../library/types.ts';
import { comparePaths } from '../reader/locator.ts';

/**
 * The bookmark for the page in view, or null. `inView` is the caller's
 * geometry predicate (the controller's, against live layout) so this stays
 * pure: chapter first — cheap and mode-independent — then the page test.
 * Ties (two bookmarks on one page, from two devices) resolve to the earliest,
 * so toggling off is deterministic.
 */
export function bookmarkOnPage(
  bookmarks: Bookmark[],
  chapter: number,
  inView: (bookmark: Bookmark) => boolean,
): Bookmark | null {
  const here = bookmarks
    .filter((b) => b.chapter === chapter && inView(b))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : 1));
  return here[0] ?? null;
}

/** Reading order: chapter, then anchor path, then how far into that element. */
export function sortBookmarks(bookmarks: Bookmark[]): Bookmark[] {
  return [...bookmarks].sort(
    (a, b) =>
      a.chapter - b.chapter ||
      comparePaths(a.anchor.path, b.anchor.path) ||
      a.anchor.ratio - b.anchor.ratio ||
      (a.id < b.id ? -1 : 1),
  );
}

/** 8 hex chars, the shape highlight ids already use; unique enough per book. */
export function newBookmarkId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Short, human date for a bookmark row ("12 Jul 2026"). */
export function bookmarkDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// --- the dog-ear ribbon ---

export interface RibbonDeps {
  /** The bookmark on the visible page, if any (null hides the ribbon). */
  current(): Bookmark | null;
}

export interface Ribbon {
  /** Re-read the state; called on turns, scrolls, chapter and mode changes. */
  refresh(): void;
}

export function createRibbon(element: HTMLElement, deps: RibbonDeps): Ribbon {
  const refresh = (): void => {
    element.hidden = deps.current() === null;
  };
  refresh();
  return { refresh };
}
