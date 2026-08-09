// The shelf used to fetch one sidecar at a time, in a for-await loop: fine on
// a local folder, but on a remote transport (Drive) each sidecar costs
// several network round trips, so N books meant N round trips back to back.
// loadShelfRows fetches them all at once instead; these tests pin that down
// deterministically (no timers, no races) and pin the degrade-on-failure
// behavior that made the old sequential code forgiving in the first place.

import { describe, expect, test } from 'bun:test';
import type { BookSidecar, LibraryEntry } from '../library/types.ts';
import { loadShelfRows, shelfMeta } from './shelf.ts';

const entry = (id: string, title: string): LibraryEntry => ({ id, dir: `books/${id}`, title });

const sidecar = (id: string, title: string, overrides: Partial<BookSidecar> = {}): BookSidecar => ({
  schema: 1,
  id,
  title,
  author: null,
  addedAt: '2026-07-12T10:00:00.000Z',
  state: 'unread',
  stateChangedAt: '2026-07-12T10:00:00.000Z',
  progress: 0,
  position: null,
  highlights: [],
  sessions: [],
  ...overrides,
});

describe('loadShelfRows', () => {
  test('fetches every sidecar at once, not one at a time', async () => {
    const entries = [entry('a', 'A'), entry('b', 'B'), entry('c', 'C')];
    const resolvers = new Map<string, (value: BookSidecar | null) => void>();
    let started = 0;
    const readSidecar = (id: string): Promise<BookSidecar | null> => {
      started++;
      return new Promise((resolve) => resolvers.set(id, resolve));
    };

    const pending = loadShelfRows(entries, readSidecar);

    // A sequential for-await loop would have started only the first read at
    // this point, since nothing has resolved yet; concurrent fetching starts
    // all three before any of them settles.
    expect(started).toBe(3);

    // Resolve out of order: the result must still land in entry order.
    resolvers.get('c')?.(sidecar('c', 'C Sidecar'));
    resolvers.get('a')?.(sidecar('a', 'A Sidecar'));
    resolvers.get('b')?.(sidecar('b', 'B Sidecar'));

    const rows = await pending;
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.title)).toEqual(['A Sidecar', 'B Sidecar', 'C Sidecar']);
  });

  test('a sidecar read failing degrades that book to its index title, not a blank shelf', async () => {
    const entries = [entry('a', 'Index Title A'), entry('b', 'Index Title B')];
    const readSidecar = async (id: string): Promise<BookSidecar | null> => {
      if (id === 'a') throw new Error('network unreachable');
      return sidecar('b', 'Sidecar Title B');
    };

    const rows = await loadShelfRows(entries, readSidecar);

    expect(rows).toEqual([
      { id: 'a', title: 'Index Title A', meta: '' },
      { id: 'b', title: 'Sidecar Title B', meta: '' },
    ]);
  });

  test('a missing sidecar falls back to the index title', async () => {
    const entries = [entry('a', 'Index Title')];
    const rows = await loadShelfRows(entries, async () => null);
    expect(rows).toEqual([{ id: 'a', title: 'Index Title', meta: '' }]);
  });
});

describe('shelfMeta', () => {
  test('is blank without a sidecar', () => {
    expect(shelfMeta(null)).toBe('');
  });

  test('joins author and a reading percent', () => {
    expect(
      shelfMeta(sidecar('a', 'A', { author: 'Someone', state: 'reading', progress: 0.42 })),
    ).toBe('Someone · 42%');
  });

  test('an unread book shows only its author, no state word', () => {
    expect(shelfMeta(sidecar('a', 'A', { author: 'Someone', state: 'unread' }))).toBe('Someone');
  });

  test('a finished book names its state', () => {
    expect(shelfMeta(sidecar('a', 'A', { state: 'finished' }))).toBe('finished');
  });
});
