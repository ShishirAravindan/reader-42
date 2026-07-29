import { describe, expect, test } from 'bun:test';
import { mergeIndexes, mergeSidecars } from './merge.ts';
import type { BookSidecar, Bookmark, Highlight, LibraryIndex, ReadingSession } from './types.ts';

const T0 = '2026-07-10T08:00:00.000Z';
const T1 = '2026-07-11T09:00:00.000Z';
const T2 = '2026-07-12T10:00:00.000Z';
const T3 = '2026-07-12T11:00:00.000Z';

function sidecar(overrides: Partial<BookSidecar> = {}): BookSidecar {
  return {
    schema: 1,
    id: 'abc123def456',
    title: 'A Book',
    author: 'An Author',
    addedAt: T0,
    state: 'reading',
    stateChangedAt: T0,
    progress: 0.2,
    position: { chapter: 1, anchor: { path: [3], ratio: 0.5 }, scroll: 100, updatedAt: T1 },
    highlights: [],
    sessions: [],
    ...overrides,
  };
}

function hl(id: string, createdAt: string, over: Partial<Highlight> = {}): Highlight {
  return {
    id,
    chapter: 1,
    start: { path: [2], offset: 0 },
    end: { path: [2], offset: 10 },
    text: `text of ${id}`,
    createdAt,
    ...over,
  };
}

function bm(id: string, createdAt: string, over: Partial<Bookmark> = {}): Bookmark {
  return { id, chapter: 2, anchor: { path: [4], ratio: 0 }, createdAt, ...over };
}

const session = (endedAt: string, seconds: number): ReadingSession => ({ endedAt, seconds });

describe('mergeSidecars: position and progress', () => {
  test('the later position.updatedAt wins, and progress follows it', () => {
    const behind = sidecar({
      progress: 0.2,
      position: { chapter: 1, scroll: 100, updatedAt: T1 },
    });
    const ahead = sidecar({
      progress: 0.7,
      position: { chapter: 5, anchor: { path: [8], ratio: 0.1 }, updatedAt: T2 },
    });
    for (const merged of [mergeSidecars(behind, ahead), mergeSidecars(ahead, behind)]) {
      expect(merged.position).toEqual(ahead.position);
      expect(merged.progress).toBe(0.7);
    }
  });

  test('a device that never read (null position) loses to one that did', () => {
    const fresh = sidecar({ position: null, progress: 0 });
    const read = sidecar({ progress: 0.4 });
    for (const merged of [mergeSidecars(fresh, read), mergeSidecars(read, fresh)]) {
      expect(merged.position).toEqual(read.position);
      expect(merged.progress).toBe(0.4);
    }
  });

  test('both null positions stay null; progress keeps the max', () => {
    const a = sidecar({ position: null, progress: 0.3 });
    const b = sidecar({ position: null, progress: 0.1 });
    const merged = mergeSidecars(a, b);
    expect(merged.position).toBeNull();
    expect(merged.progress).toBe(0.3);
  });

  test('an equal clock resolves by value, not argument order', () => {
    const x = sidecar({ position: { chapter: 2, updatedAt: T1 } });
    const y = sidecar({ position: { chapter: 3, updatedAt: T1 } });
    expect(mergeSidecars(x, y).position).toEqual(mergeSidecars(y, x).position);
  });
});

describe('mergeSidecars: state', () => {
  test('the later stateChangedAt wins the state pair', () => {
    const stillReading = sidecar({ state: 'reading', stateChangedAt: T1 });
    const finished = sidecar({ state: 'finished', stateChangedAt: T2 });
    for (const merged of [
      mergeSidecars(stillReading, finished),
      mergeSidecars(finished, stillReading),
    ]) {
      expect(merged.state).toBe('finished');
      expect(merged.stateChangedAt).toBe(T2);
    }
  });

  test('state and position resolve independently: each family keeps its own clock', () => {
    // Device A finished the book yesterday; device B scrolled around today
    // without changing state. B wins position, A keeps state.
    const a = sidecar({
      state: 'finished',
      stateChangedAt: T1,
      progress: 1,
      position: { chapter: 9, updatedAt: T1 },
    });
    const b = sidecar({
      state: 'reading',
      stateChangedAt: T0,
      progress: 0.5,
      position: { chapter: 4, updatedAt: T2 },
    });
    const merged = mergeSidecars(a, b);
    expect(merged.state).toBe('finished');
    expect(merged.position?.chapter).toBe(4);
    expect(merged.progress).toBe(0.5);
  });
});

describe('mergeSidecars: highlights', () => {
  test('disjoint highlights union, ordered by creation', () => {
    const a = sidecar({ highlights: [hl('h2', T2)] });
    const b = sidecar({ highlights: [hl('h1', T1)] });
    const merged = mergeSidecars(a, b);
    expect(merged.highlights.map((h) => h.id)).toEqual(['h1', 'h2']);
  });

  test('the same id from both devices dedupes to one', () => {
    const a = sidecar({ highlights: [hl('h1', T1)] });
    const b = sidecar({ highlights: [hl('h1', T1)] });
    expect(mergeSidecars(a, b).highlights).toHaveLength(1);
  });

  test('a note added on one device survives the merge', () => {
    const plain = sidecar({ highlights: [hl('h1', T1)] });
    const noted = sidecar({ highlights: [hl('h1', T1, { note: 'important' })] });
    for (const merged of [mergeSidecars(plain, noted), mergeSidecars(noted, plain)]) {
      expect(merged.highlights[0]?.note).toBe('important');
    }
  });

  test('notes on both sides: the later highlight wins', () => {
    const older = sidecar({ highlights: [hl('h1', T1, { note: 'first thought' })] });
    const newer = sidecar({ highlights: [hl('h1', T2, { note: 'second thought' })] });
    for (const merged of [mergeSidecars(older, newer), mergeSidecars(newer, older)]) {
      expect(merged.highlights[0]?.note).toBe('second thought');
    }
  });

  test('highlights from three devices interleave and stay complete', () => {
    const a = sidecar({ highlights: [hl('h1', T0), hl('h3', T2)] });
    const b = sidecar({ highlights: [hl('h1', T0), hl('h2', T1)] });
    const merged = mergeSidecars(a, b);
    expect(merged.highlights.map((h) => h.id)).toEqual(['h1', 'h2', 'h3']);
  });

  test('a recolor (editedAt) beats the untouched copy from the other device', () => {
    const untouched = sidecar({ highlights: [hl('h1', T0)] });
    const recolored = sidecar({ highlights: [hl('h1', T0, { color: 'pink', editedAt: T2 })] });
    for (const merged of [
      mergeSidecars(untouched, recolored),
      mergeSidecars(recolored, untouched),
    ]) {
      expect(merged.highlights[0]?.color).toBe('pink');
      expect(merged.highlights[0]?.editedAt).toBe(T2);
    }
  });

  test('conflicting edits: the later editedAt wins the whole record', () => {
    const recoloredEarlier = sidecar({
      highlights: [hl('h1', T0, { color: 'blue', editedAt: T1 })],
    });
    const notedLater = sidecar({
      highlights: [hl('h1', T0, { note: 'the later thought', editedAt: T2 })],
    });
    for (const merged of [
      mergeSidecars(recoloredEarlier, notedLater),
      mergeSidecars(notedLater, recoloredEarlier),
    ]) {
      // Record-wise, not field-wise: the blue recolor is lost to the later edit.
      expect(merged.highlights[0]?.note).toBe('the later thought');
      expect(merged.highlights[0]?.color).toBeUndefined();
      expect(merged.highlights[0]?.editedAt).toBe(T2);
    }
  });

  test('an edited bare record beats an unedited annotated one (editedAt is the clock)', () => {
    const notedAtCreation = sidecar({ highlights: [hl('h1', T0, { note: 'first' })] });
    const recoloredLater = sidecar({
      highlights: [hl('h1', T0, { color: 'orange', editedAt: T2 })],
    });
    for (const merged of [
      mergeSidecars(notedAtCreation, recoloredLater),
      mergeSidecars(recoloredLater, notedAtCreation),
    ]) {
      expect(merged.highlights[0]?.color).toBe('orange');
      expect(merged.highlights[0]?.note).toBeUndefined();
    }
  });

  test('equal edit clocks keep the note preference, then resolve by value', () => {
    const noted = sidecar({ highlights: [hl('h1', T0, { note: 'kept', editedAt: T2 })] });
    const bare = sidecar({ highlights: [hl('h1', T0, { color: 'pink', editedAt: T2 })] });
    for (const merged of [mergeSidecars(noted, bare), mergeSidecars(bare, noted)]) {
      expect(merged.highlights[0]?.note).toBe('kept');
    }
  });
});

describe('mergeSidecars: bookmarks', () => {
  test('bookmarks set on two devices union, ordered by creation', () => {
    const phone = sidecar({ bookmarks: [bm('b2', T2)] });
    const laptop = sidecar({ bookmarks: [bm('b1', T1)] });
    for (const merged of [mergeSidecars(phone, laptop), mergeSidecars(laptop, phone)]) {
      expect(merged.bookmarks?.map((b) => b.id)).toEqual(['b1', 'b2']);
    }
  });

  test('the same bookmark from both devices dedupes to one', () => {
    const a = sidecar({ bookmarks: [bm('b1', T1)] });
    const b = sidecar({ bookmarks: [bm('b1', T1)] });
    expect(mergeSidecars(a, b).bookmarks).toHaveLength(1);
  });

  test('a device that never bookmarked keeps the other device’s bookmarks', () => {
    const none = sidecar();
    const some = sidecar({ bookmarks: [bm('b1', T1)] });
    for (const merged of [mergeSidecars(none, some), mergeSidecars(some, none)]) {
      expect(merged.bookmarks?.map((b) => b.id)).toEqual(['b1']);
    }
  });

  test('sidecars with no bookmarks merge to a sidecar with no bookmarks field', () => {
    expect(mergeSidecars(sidecar(), sidecar())).not.toHaveProperty('bookmarks');
  });

  test('an equal clock resolves by value, not argument order', () => {
    const x = sidecar({ bookmarks: [bm('b1', T1, { chapter: 3 })] });
    const y = sidecar({ bookmarks: [bm('b1', T1, { chapter: 7 })] });
    expect(mergeSidecars(x, y).bookmarks).toEqual(mergeSidecars(y, x).bookmarks);
  });

  test('a delete on one device loses to the surviving copy (union, documented)', () => {
    const deleted = sidecar({ bookmarks: [bm('b1', T1)] });
    const kept = sidecar({ bookmarks: [bm('b1', T1), bm('b2', T2)] });
    expect(mergeSidecars(deleted, kept).bookmarks?.map((b) => b.id)).toEqual(['b1', 'b2']);
  });
});

describe('mergeSidecars: sessions', () => {
  test('sessions union by value: shared history dedupes, new stretches join', () => {
    const a = sidecar({ sessions: [session(T1, 600), session(T2, 300)] });
    const b = sidecar({ sessions: [session(T1, 600), session(T3, 1200)] });
    const merged = mergeSidecars(a, b);
    expect(merged.sessions).toEqual([session(T1, 600), session(T2, 300), session(T3, 1200)]);
  });

  test('same endedAt with different seconds are distinct sessions, both kept', () => {
    const a = sidecar({ sessions: [session(T1, 600)] });
    const b = sidecar({ sessions: [session(T1, 240)] });
    expect(mergeSidecars(a, b).sessions).toHaveLength(2);
  });
});

describe('mergeSidecars: identity and metadata', () => {
  test('different ids are a caller bug and throw', () => {
    expect(() => mergeSidecars(sidecar(), sidecar({ id: 'other0000000' }))).toThrow();
  });

  test('the earliest addition keeps title, author, addedAt', () => {
    const original = sidecar({ addedAt: T0, title: 'A Book', author: 'An Author' });
    const reimport = sidecar({ addedAt: T2, title: 'A Book (1)', author: null });
    for (const merged of [mergeSidecars(original, reimport), mergeSidecars(reimport, original)]) {
      expect(merged.title).toBe('A Book');
      expect(merged.author).toBe('An Author');
      expect(merged.addedAt).toBe(T0);
    }
  });
});

describe('mergeSidecars: algebra', () => {
  // The properties that make eventual convergence true regardless of which
  // device flushes first, second, or repeatedly.
  const variants: BookSidecar[] = [
    sidecar({
      state: 'finished',
      stateChangedAt: T2,
      progress: 1,
      position: { chapter: 9, updatedAt: T2 },
      highlights: [hl('h1', T0), hl('h2', T1, { note: 'nb' })],
      bookmarks: [bm('b1', T0), bm('b2', T1)],
      sessions: [session(T1, 600)],
    }),
    sidecar({
      state: 'reading',
      stateChangedAt: T1,
      progress: 0.5,
      position: { chapter: 4, anchor: { path: [2, 1], ratio: 0.25 }, updatedAt: T3 },
      highlights: [hl('h2', T1, { color: 'pink', editedAt: T3 }), hl('h3', T2)],
      bookmarks: [bm('b2', T1), bm('b3', T2, { chapter: 5 })],
      sessions: [session(T2, 300)],
    }),
    sidecar({
      position: null,
      progress: 0,
      highlights: [hl('h2', T1, { note: 'nb', editedAt: T2 }), hl('h4', T3)],
      sessions: [],
    }),
  ];
  const [va, vb, vc] = variants as [BookSidecar, BookSidecar, BookSidecar];

  test('idempotent: merge(a, a) = a', () => {
    for (const v of variants) {
      expect(mergeSidecars(v, v)).toEqual(v);
    }
  });

  test('commutative: merge(a, b) = merge(b, a)', () => {
    for (const x of variants) {
      for (const y of variants) {
        expect(mergeSidecars(x, y)).toEqual(mergeSidecars(y, x));
      }
    }
  });

  test('associative: merge order across three devices does not matter', () => {
    const left = mergeSidecars(mergeSidecars(va, vb), vc);
    const right = mergeSidecars(va, mergeSidecars(vb, vc));
    expect(left).toEqual(right);
  });
});

describe('mergeIndexes', () => {
  function index(over: Partial<LibraryIndex> = {}): LibraryIndex {
    return {
      schema: 1,
      updatedAt: T1,
      books: [
        { id: 'aaa', dir: 'books/alpha-aaa', title: 'Alpha' },
        { id: 'bbb', dir: 'books/beta-bbb', title: 'Beta' },
      ],
      onDeck: ['aaa'],
      ...over,
    };
  }

  test('books union by id: an offline import on one device is never lost', () => {
    const withImport = index({
      updatedAt: T2,
      books: [...index().books, { id: 'ccc', dir: 'books/gamma-ccc', title: 'Gamma' }],
    });
    const without = index();
    for (const merged of [mergeIndexes(withImport, without), mergeIndexes(without, withImport)]) {
      expect(merged.books.map((b) => b.id)).toEqual(['aaa', 'bbb', 'ccc']);
    }
  });

  test('the later index wins the deck wholesale; unknown ids are dropped', () => {
    const older = index({ updatedAt: T1, onDeck: ['aaa', 'bbb'] });
    const newer = index({ updatedAt: T2, onDeck: ['bbb', 'zzz'] });
    for (const merged of [mergeIndexes(older, newer), mergeIndexes(newer, older)]) {
      expect(merged.onDeck).toEqual(['bbb']);
      expect(merged.updatedAt).toBe(T2);
    }
  });

  test('idempotent and commutative', () => {
    const a = index({ updatedAt: T2 });
    const b = index({
      books: [{ id: 'ddd', dir: 'books/delta-ddd', title: 'Delta' }],
      onDeck: ['ddd'],
    });
    expect(mergeIndexes(a, a)).toEqual(a);
    expect(mergeIndexes(a, b)).toEqual(mergeIndexes(b, a));
  });
});
