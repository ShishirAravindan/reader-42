// Cross-device merge of the library files.
//
// Two devices write the same sidecar; neither is wrong. The contract
// (types.ts) gives every mergeable field family its own clock precisely so
// this module can resolve field-wise instead of clobbering whole files:
//
//   position + progress   position.updatedAt, latest wins
//   state                 stateChangedAt, latest wins
//   highlights            union by id; same-id edits resolve by editedAt
//   bookmarks             union by id (bookmarks are never edited)
//   sessions              union by value (append-only on both sides)
//   addedAt/title/author  the earliest addition wins (import metadata)
//
// The merge is deterministic, commutative, associative, and idempotent —
// merge.test.ts asserts all four — so any two devices that have seen the
// same writes converge on identical bytes, regardless of flush order.
// Clock ties resolve by comparing serialized values, never by argument
// order.

import type { BookSidecar, Bookmark, Highlight, LibraryIndex, ReadingSession } from './types.ts';

/**
 * An ISO timestamp as a number, with an unreadable one treated as the oldest
 * clock there is. A device with a broken clock, a hand-edited file, or a field
 * from a future version all yield NaN — and NaN loses every comparison, so an
 * unguarded compare falls through to `NaN > NaN ? a : b` and always answers
 * `b`. That is not a rule: it makes the merge depend on argument order, so two
 * devices that saw the same writes stop converging.
 */
function clockOf(iso: string): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

/** Compare ISO timestamps; ties fall through to a deterministic value compare. */
function laterOf<T>(a: T, aClock: string, b: T, bClock: string): T {
  const at = clockOf(aClock);
  const bt = clockOf(bClock);
  if (at !== bt) return at > bt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/**
 * Same-id conflict: a lexicographic total order, so the pick is associative
 * and commutative no matter which device flushes first. Keys, in order:
 * the edit clock (editedAt, falling back to createdAt — so a record recolored
 * or annotated later wins over an untouched copy), then the note preference
 * (an annotated record beats a bare one at equal clocks), then createdAt,
 * then the deterministic value compare inside laterOf.
 */
function preferHighlight(a: Highlight, b: Highlight): Highlight {
  const aClock = clockOf(a.editedAt ?? a.createdAt);
  const bClock = clockOf(b.editedAt ?? b.createdAt);
  if (aClock !== bClock) return aClock > bClock ? a : b;
  if (a.note && !b.note) return a;
  if (b.note && !a.note) return b;
  return laterOf(a, a.createdAt, b, b.createdAt);
}

function mergeHighlights(a: Highlight[], b: Highlight[]): Highlight[] {
  const byId = new Map<string, Highlight>();
  for (const hl of [...a, ...b]) {
    const seen = byId.get(hl.id);
    byId.set(hl.id, seen ? preferHighlight(seen, hl) : hl);
  }
  return [...byId.values()].sort(
    (x, y) => clockOf(x.createdAt) - clockOf(y.createdAt) || (x.id < y.id ? -1 : 1),
  );
}

/**
 * Bookmarks union by id and are never edited in place, so a same-id pair from
 * two devices is the same bookmark: the deterministic value compare settles
 * any byte difference. Union means a delete on one device loses to a copy on
 * the other (the bookmark comes back) — the same accepted semantics as
 * highlights, and the price of never losing a page someone marked.
 */
function mergeBookmarks(a: Bookmark[], b: Bookmark[]): Bookmark[] {
  const byId = new Map<string, Bookmark>();
  for (const bm of [...a, ...b]) {
    const seen = byId.get(bm.id);
    byId.set(bm.id, seen ? laterOf(seen, seen.createdAt, bm, bm.createdAt) : bm);
  }
  return [...byId.values()].sort(
    (x, y) => clockOf(x.createdAt) - clockOf(y.createdAt) || (x.id < y.id ? -1 : 1),
  );
}

function mergeSessions(a: ReadingSession[], b: ReadingSession[]): ReadingSession[] {
  const byValue = new Map<string, ReadingSession>();
  for (const s of [...a, ...b]) {
    byValue.set(`${s.endedAt}|${s.seconds}`, s);
  }
  return [...byValue.values()].sort(
    (x, y) => clockOf(x.endedAt) - clockOf(y.endedAt) || x.seconds - y.seconds,
  );
}

/**
 * Merge two versions of the same book's sidecar. Throws if the ids differ:
 * that is a caller bug, not foreign data (foreign data is parseSidecar's
 * job, and both inputs here are already parsed).
 */
export function mergeSidecars(a: BookSidecar, b: BookSidecar): BookSidecar {
  if (a.id !== b.id) {
    throw new Error(`merge: sidecars for different books (${a.id} vs ${b.id})`);
  }

  // Position and progress move together (the controller writes them as a
  // pair), so the position clock decides both.
  const positionWinner =
    a.position && b.position
      ? laterOf(a, a.position.updatedAt, b, b.position.updatedAt)
      : ((a.position ? a : null) ?? (b.position ? b : null));

  const stateWinner = laterOf(a, a.stateChangedAt, b, b.stateChangedAt);

  // Absent stays absent: a pair of sidecars that never carried bookmarks
  // merges back to a sidecar without the field (idempotence on old files).
  const bookmarks = mergeBookmarks(a.bookmarks ?? [], b.bookmarks ?? []);

  // Import metadata: the earliest addition is the origin.
  const addedWinner =
    clockOf(a.addedAt) !== clockOf(b.addedAt)
      ? clockOf(a.addedAt) < clockOf(b.addedAt)
        ? a
        : b
      : laterOf(a, a.addedAt, b, b.addedAt);

  return {
    schema: 1,
    id: a.id,
    title: addedWinner.title,
    author: addedWinner.author,
    addedAt: addedWinner.addedAt,
    state: stateWinner.state,
    stateChangedAt: stateWinner.stateChangedAt,
    progress: positionWinner ? positionWinner.progress : Math.max(a.progress, b.progress),
    position: positionWinner ? positionWinner.position : null,
    highlights: mergeHighlights(a.highlights, b.highlights),
    ...(bookmarks.length > 0 ? { bookmarks } : {}),
    sessions: mergeSessions(a.sessions, b.sessions),
  };
}

/**
 * Merge two versions of the library index. Books union by id (an id names
 * identical bytes, so either entry's dir/title serves; ties resolve by
 * value); the on-deck queue is taste, not a union — the later index wins it
 * wholesale.
 */
export function mergeIndexes(a: LibraryIndex, b: LibraryIndex): LibraryIndex {
  const byId = new Map<string, { entry: LibraryIndex['books'][number]; clock: string }>();
  for (const [index, entry] of [
    ...a.books.map((e) => [a, e] as const),
    ...b.books.map((e) => [b, e] as const),
  ]) {
    const seen = byId.get(entry.id);
    byId.set(
      entry.id,
      seen && laterOf(seen.entry, seen.clock, entry, index.updatedAt) === seen.entry
        ? seen
        : { entry, clock: index.updatedAt },
    );
  }
  const books = [...byId.values()].map((v) => v.entry);
  const deckWinner = laterOf(a, a.updatedAt, b, b.updatedAt);
  return {
    schema: 1,
    updatedAt: laterOf(a.updatedAt, a.updatedAt, b.updatedAt, b.updatedAt),
    books: books.sort((x, y) => (x.id < y.id ? -1 : 1)),
    onDeck: deckWinner.onDeck.filter((id) => byId.has(id)),
  };
}
