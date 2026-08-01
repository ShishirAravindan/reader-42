// The library file contract.
//
// The library is a folder; these types are the public shape of what lives in
// it. Anything that reads or writes the library (the reader, agents, scripts)
// programs against this file. Layout:
//
//   <library-root>/
//     library.json            directory of the library (see LibraryIndex)
//     books/
//       <slug>-<id>/
//         book.epub           the book, byte-identical to what was imported
//         book.json           everything the reader knows about it (BookSidecar)
//
// Source-of-truth rule: the sidecar is authoritative for everything about its
// book. library.json is only a directory (id → folder) plus the on-deck queue;
// its `title` field is a display cache for humans browsing the folder, never
// read back as truth.
//
// Sync rule the shapes are designed for: sidecars from two devices merge
// field-wise, not whole-file. Position resolves by its own `updatedAt`
// (latest wins), state by `stateChangedAt`, highlights, bookmarks and
// sessions union by id / value. Every mergeable field family therefore
// carries its own clock.
//
// All timestamps are ISO 8601 strings: the files are meant to be read by
// humans in a file browser, not just by code.

/** Reading lifecycle. Flat and honest; no queue states, no pipeline states. */
export type BookState = 'unread' | 'reading' | 'finished' | 'dnf';

/**
 * Structural position inside a chapter: child-index path from the chapter
 * root to an element, plus how far into that element the viewport sits.
 * Mode- and axis-independent; survives font, theme, and display-mode changes.
 * Ratio is normally 0..1 but may be captured slightly outside when the
 * viewport lands in a margin gap; readers clamp on restore.
 */
export interface PositionAnchor {
  path: number[];
  ratio: number;
}

/** One end of a highlight: an element path plus a character offset into that element's flattened text. */
export interface HighlightBoundary {
  path: number[];
  offset: number;
}

/** The four Kindle-parity highlight tints (F1). */
export const HIGHLIGHT_COLORS = ['yellow', 'pink', 'blue', 'orange'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface Highlight {
  id: string;
  chapter: number;
  start: HighlightBoundary;
  end: HighlightBoundary;
  /** The highlighted text, whitespace-collapsed, capped at 5000 chars. */
  text: string;
  /** Absent means yellow: sidecars written before colors existed stay valid. */
  color?: HighlightColor;
  note?: string;
  createdAt: string;
  /** Clock for color/note edits; a record edited later wins the merge. */
  editedAt?: string;
}

/**
 * A bookmarked page (parity G1/G2). Place, not taste, so it lives in the
 * synced sidecar (kickoff resolution 4 — the v1 localStorage bookmark was the
 * debt this fixes). The anchor is the same structural locator a position uses,
 * so a bookmark set on a phone resolves on a laptop at another font size.
 */
export interface Bookmark {
  id: string;
  chapter: number;
  anchor: PositionAnchor;
  createdAt: string;
}

/** A completed reading stretch. Append-only; unioned across devices. */
export interface ReadingSession {
  seconds: number;
  endedAt: string;
}

/**
 * Where the reader left off. Structural only: a chapter plus an anchor, never
 * a pixel offset. A pixel offset means something different in each display
 * mode (a column offset paged, a scroll offset in scroll mode) and at every
 * type size, so restoring one on a second device lands somewhere unrelated.
 * Positions are structural and mode-independent, or they do not sync.
 *
 * Sidecars written before this rule may still carry a `scroll` field; it is
 * ignored on read (see parse.ts) and never written again.
 */
export interface ReadingPosition {
  chapter: number;
  /** Structural locator; the thing that actually restores the place. */
  anchor?: PositionAnchor;
  /** Latest-wins clock for cross-device merge. */
  updatedAt: string;
}

/** `book.json`: the sidecar next to each `book.epub`. Authoritative for its book. */
export interface BookSidecar {
  schema: 1;
  /** First 12 hex chars of sha256 over the EPUB bytes. Identity and dedup in one. */
  id: string;
  title: string;
  author: string | null;
  addedAt: string;
  state: BookState;
  stateChangedAt: string;
  /** Overall progress 0..1, updated alongside position. */
  progress: number;
  position: ReadingPosition | null;
  highlights: Highlight[];
  /** Absent means none: sidecars written before bookmarks existed stay valid. */
  bookmarks?: Bookmark[];
  sessions: ReadingSession[];
}

/** One row in the library directory. */
export interface LibraryEntry {
  id: string;
  /** Folder relative to the library root, e.g. "books/the-dawn-of-everything-3f2a1c9d8e7b". */
  dir: string;
  /** Display cache for humans; the sidecar is the truth. */
  title: string;
}

/** `library.json`: directory of the library plus the on-deck queue. */
export interface LibraryIndex {
  schema: 1;
  updatedAt: string;
  books: LibraryEntry[];
  /** Deliberately capped next-up queue, ordered. The cap is the friction. */
  onDeck: string[];
}

export const SIDECAR_FILENAME = 'book.json';
export const EPUB_FILENAME = 'book.epub';
export const INDEX_FILENAME = 'library.json';
export const ON_DECK_CAP = 5;
export const HIGHLIGHT_TEXT_CAP = 5000;
