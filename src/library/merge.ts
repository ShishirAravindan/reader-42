// Cross-device merge of the library files.
//
// Two devices write the same sidecar; neither is wrong. The contract
// (types.ts) gives every mergeable field family its own clock precisely so
// this module can resolve field-wise instead of clobbering whole files:
//
//   position + progress   position.updatedAt, latest wins
//   state                 stateChangedAt, latest wins
//   highlights            union by id
//   sessions              union by value (append-only on both sides)
//   addedAt/title/author  the earliest addition wins (import metadata)
//
// The merge is deterministic, commutative, associative, and idempotent —
// merge.test.ts asserts all four — so any two devices that have seen the
// same writes converge on identical bytes, regardless of flush order.
// Clock ties resolve by comparing serialized values, never by argument
// order.

import type { BookSidecar, Highlight, LibraryIndex, ReadingSession } from './types.ts';

/** Compare ISO timestamps; ties fall through to a deterministic value compare. */
function laterOf<T>(a: T, aClock: string, b: T, bClock: string): T {
  const at = Date.parse(aClock);
  const bt = Date.parse(bClock);
  if (at !== bt) return at > bt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeHighlights(a: Highlight[], b: Highlight[]): Highlight[] {
  const byId = new Map<string, Highlight>();
  for (const hl of [...a, ...b]) {
    const seen = byId.get(hl.id);
    if (!seen) {
      byId.set(hl.id, hl);
      continue;
    }
    // Same id from both devices. Identical in practice; if they diverge
    // (a note added on one side), prefer the annotated one, then the later
    // one, then the deterministic value compare inside laterOf.
    if (seen.note && !hl.note) continue;
    if (hl.note && !seen.note) {
      byId.set(hl.id, hl);
      continue;
    }
    byId.set(hl.id, laterOf(seen, seen.createdAt, hl, hl.createdAt));
  }
  return [...byId.values()].sort(
    (x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : 1),
  );
}

function mergeSessions(a: ReadingSession[], b: ReadingSession[]): ReadingSession[] {
  const byValue = new Map<string, ReadingSession>();
  for (const s of [...a, ...b]) {
    byValue.set(`${s.endedAt}|${s.seconds}`, s);
  }
  return [...byValue.values()].sort(
    (x, y) => Date.parse(x.endedAt) - Date.parse(y.endedAt) || x.seconds - y.seconds,
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

  // Import metadata: the earliest addition is the origin.
  const addedWinner =
    Date.parse(a.addedAt) !== Date.parse(b.addedAt)
      ? Date.parse(a.addedAt) < Date.parse(b.addedAt)
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
