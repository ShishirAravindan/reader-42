// Parsing and sanitizing the library files.
//
// Degradation rule (learned the hard way in the previous implementation):
// old or foreign data degrades, it never crashes. A sidecar with a corrupt
// anchor loses the anchor, not the book; an unknown state becomes 'unread';
// a malformed highlight is dropped. Parsers here return the best valid value
// they can, so every caller reads a well-formed shape.

import {
  type BookSidecar,
  type BookState,
  type Bookmark,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_TEXT_CAP,
  type Highlight,
  type HighlightBoundary,
  type HighlightColor,
  type LibraryIndex,
  type PositionAnchor,
  type ReadingPosition,
  type ReadingSession,
} from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asIsoDate(value: unknown): string | null {
  const s = asString(value);
  if (!s || Number.isNaN(Date.parse(s))) return null;
  return s;
}

function asIndexPath(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const path: number[] = [];
  for (const step of value) {
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 0) return null;
    path.push(step);
  }
  return path;
}

export function parseAnchor(value: unknown): PositionAnchor | null {
  if (!isRecord(value)) return null;
  const path = asIndexPath(value.path);
  const ratio = value.ratio;
  if (!path || typeof ratio !== 'number' || !Number.isFinite(ratio)) return null;
  // Capture may legitimately overshoot into a margin gap; keep it bounded.
  return { path, ratio: Math.min(Math.max(ratio, -1), 2) };
}

function parseBoundary(value: unknown): HighlightBoundary | null {
  if (!isRecord(value)) return null;
  const path = asIndexPath(value.path);
  const offset = value.offset;
  if (!path || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) return null;
  return { path, offset };
}

export function parseHighlight(value: unknown): Highlight | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const chapter = value.chapter;
  const start = parseBoundary(value.start);
  const end = parseBoundary(value.end);
  const text = asString(value.text);
  const createdAt = asIsoDate(value.createdAt);
  if (
    !id ||
    typeof chapter !== 'number' ||
    !Number.isInteger(chapter) ||
    chapter < 0 ||
    !start ||
    !end ||
    !text ||
    !createdAt
  ) {
    return null;
  }
  const note = asString(value.note);
  // Optional fields degrade individually: an unknown color or a mangled
  // editedAt drops the FIELD, never the highlight.
  const color = HIGHLIGHT_COLORS.includes(value.color as HighlightColor)
    ? (value.color as HighlightColor)
    : null;
  const editedAt = asIsoDate(value.editedAt);
  return {
    id,
    chapter,
    start,
    end,
    text: text.slice(0, HIGHLIGHT_TEXT_CAP),
    ...(color ? { color } : {}),
    ...(note ? { note } : {}),
    createdAt,
    ...(editedAt ? { editedAt } : {}),
  };
}

/**
 * A bookmark is its anchor: without a resolvable one there is no page to
 * return to, so a corrupt anchor drops the whole record rather than leaving a
 * bookmark that would silently land at the top of the chapter.
 */
export function parseBookmark(value: unknown): Bookmark | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const chapter = value.chapter;
  const anchor = parseAnchor(value.anchor);
  const createdAt = asIsoDate(value.createdAt);
  if (
    !id ||
    typeof chapter !== 'number' ||
    !Number.isInteger(chapter) ||
    chapter < 0 ||
    !anchor ||
    !createdAt
  ) {
    return null;
  }
  return { id, chapter, anchor, createdAt };
}

function parsePosition(value: unknown): ReadingPosition | null {
  if (!isRecord(value)) return null;
  const chapter = value.chapter;
  const updatedAt = asIsoDate(value.updatedAt);
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 0 || !updatedAt) {
    return null;
  }
  const anchor = parseAnchor(value.anchor);
  const scroll =
    typeof value.scroll === 'number' && Number.isFinite(value.scroll) && value.scroll >= 0
      ? value.scroll
      : null;
  return {
    chapter,
    ...(anchor ? { anchor } : {}),
    ...(scroll !== null ? { scroll } : {}),
    updatedAt,
  };
}

function parseSession(value: unknown): ReadingSession | null {
  if (!isRecord(value)) return null;
  const seconds = value.seconds;
  const endedAt = asIsoDate(value.endedAt);
  if (
    typeof seconds !== 'number' ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    seconds > 86400 ||
    !endedAt
  ) {
    return null;
  }
  return { seconds, endedAt };
}

function parseState(value: unknown): BookState {
  return value === 'reading' || value === 'finished' || value === 'dnf' ? value : 'unread';
}

/**
 * Parse a sidecar from unknown JSON. Returns null only when the data cannot
 * identify a book at all (no id or title); everything else degrades.
 */
export function parseSidecar(value: unknown, fallbackNow: string): BookSidecar | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const title = asString(value.title);
  if (!id || !title) return null;

  const highlights: Highlight[] = [];
  if (Array.isArray(value.highlights)) {
    for (const raw of value.highlights) {
      const hl = parseHighlight(raw);
      if (hl) highlights.push(hl);
    }
  }
  const bookmarks: Bookmark[] = [];
  if (Array.isArray(value.bookmarks)) {
    for (const raw of value.bookmarks) {
      const bm = parseBookmark(raw);
      if (bm) bookmarks.push(bm);
    }
  }
  const sessions: ReadingSession[] = [];
  if (Array.isArray(value.sessions)) {
    for (const raw of value.sessions) {
      const s = parseSession(raw);
      if (s) sessions.push(s);
    }
  }

  const progress = value.progress;
  return {
    schema: 1,
    id,
    title,
    author: asString(value.author),
    addedAt: asIsoDate(value.addedAt) ?? fallbackNow,
    state: parseState(value.state),
    stateChangedAt: asIsoDate(value.stateChangedAt) ?? fallbackNow,
    progress:
      typeof progress === 'number' && Number.isFinite(progress)
        ? Math.min(Math.max(progress, 0), 1)
        : 0,
    position: parsePosition(value.position),
    highlights,
    // Omitted when empty: a sidecar that never had bookmarks round-trips
    // byte-identical, so the field only appears once one is set.
    ...(bookmarks.length > 0 ? { bookmarks } : {}),
    sessions,
  };
}

/** Parse the library index. A malformed index degrades to an empty library, never a crash. */
export function parseIndex(value: unknown, fallbackNow: string): LibraryIndex {
  const empty: LibraryIndex = { schema: 1, updatedAt: fallbackNow, books: [], onDeck: [] };
  if (!isRecord(value)) return empty;

  const books: LibraryIndex['books'] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.books)) {
    for (const raw of value.books) {
      if (!isRecord(raw)) continue;
      const id = asString(raw.id);
      const dir = asString(raw.dir);
      if (!id || !dir || seen.has(id)) continue;
      seen.add(id);
      books.push({ id, dir, title: asString(raw.title) ?? id });
    }
  }

  const onDeck: string[] = [];
  if (Array.isArray(value.onDeck)) {
    for (const raw of value.onDeck) {
      const id = asString(raw);
      if (id && seen.has(id) && !onDeck.includes(id)) onDeck.push(id);
    }
  }

  return {
    schema: 1,
    updatedAt: asIsoDate(value.updatedAt) ?? fallbackNow,
    books,
    onDeck,
  };
}
