import { describe, expect, test } from 'bun:test';
import { parseAnchor, parseHighlight, parseIndex, parseSidecar } from './parse.ts';

const NOW = '2026-07-12T00:00:00.000Z';

const validSidecar = {
  schema: 1,
  id: 'abc123def456',
  title: 'The Dawn of Everything',
  author: 'Graeber & Wengrow',
  addedAt: '2026-07-01T10:00:00.000Z',
  state: 'reading',
  stateChangedAt: '2026-07-02T10:00:00.000Z',
  progress: 0.42,
  position: {
    chapter: 3,
    anchor: { path: [12, 1], ratio: 0.3 },
    scroll: 1234,
    updatedAt: '2026-07-03T10:00:00.000Z',
  },
  highlights: [
    {
      id: 'hl1',
      chapter: 3,
      start: { path: [12, 1], offset: 10 },
      end: { path: [12, 1], offset: 42 },
      text: 'a highlighted passage',
      note: 'important',
      createdAt: '2026-07-03T11:00:00.000Z',
    },
  ],
  sessions: [{ seconds: 1200, endedAt: '2026-07-03T12:00:00.000Z' }],
};

describe('parseSidecar', () => {
  test('valid sidecar round-trips', () => {
    const parsed = parseSidecar(validSidecar, NOW);
    expect(parsed).toEqual(validSidecar as never);
  });

  test('null without an identity (id + title)', () => {
    expect(parseSidecar({ ...validSidecar, id: undefined }, NOW)).toBeNull();
    expect(parseSidecar({ ...validSidecar, title: '' }, NOW)).toBeNull();
    expect(parseSidecar('not an object', NOW)).toBeNull();
  });

  test('corrupt anchor loses the anchor, not the position or the book', () => {
    const parsed = parseSidecar(
      {
        ...validSidecar,
        position: { chapter: 3, anchor: { path: [-1], ratio: 0.3 }, updatedAt: NOW },
      },
      NOW,
    );
    expect(parsed?.position?.chapter).toBe(3);
    expect(parsed?.position?.anchor).toBeUndefined();
  });

  test('position without a clock is dropped (merge needs updatedAt)', () => {
    const parsed = parseSidecar({ ...validSidecar, position: { chapter: 3 } }, NOW);
    expect(parsed?.position).toBeNull();
  });

  test('unknown state degrades to unread', () => {
    const parsed = parseSidecar({ ...validSidecar, state: 'archived' }, NOW);
    expect(parsed?.state).toBe('unread');
  });

  test('malformed highlights are dropped, valid ones kept', () => {
    const parsed = parseSidecar(
      {
        ...validSidecar,
        highlights: [validSidecar.highlights[0], { id: 'broken' }, 42],
      },
      NOW,
    );
    expect(parsed?.highlights).toHaveLength(1);
    expect(parsed?.highlights[0]?.id).toBe('hl1');
  });

  test('progress clamps to 0..1', () => {
    expect(parseSidecar({ ...validSidecar, progress: 7 }, NOW)?.progress).toBe(1);
    expect(parseSidecar({ ...validSidecar, progress: -1 }, NOW)?.progress).toBe(0);
    expect(parseSidecar({ ...validSidecar, progress: 'much' }, NOW)?.progress).toBe(0);
  });

  test('missing dates fall back to now', () => {
    const parsed = parseSidecar({ id: 'x'.repeat(12), title: 'Bare' }, NOW);
    expect(parsed?.addedAt).toBe(NOW);
    expect(parsed?.stateChangedAt).toBe(NOW);
    expect(parsed?.highlights).toEqual([]);
    expect(parsed?.sessions).toEqual([]);
  });
});

describe('parseAnchor', () => {
  test('ratio is bounded to the margin-gap range', () => {
    expect(parseAnchor({ path: [0], ratio: 99 })?.ratio).toBe(2);
    expect(parseAnchor({ path: [0], ratio: -99 })?.ratio).toBe(-1);
  });

  test('rejects non-integer or oversized paths', () => {
    expect(parseAnchor({ path: [1.5], ratio: 0 })).toBeNull();
    expect(parseAnchor({ path: Array(33).fill(0), ratio: 0 })).toBeNull();
  });
});

describe('parseHighlight', () => {
  test('caps stored text length', () => {
    const hl = parseHighlight({
      ...validSidecar.highlights[0],
      text: 'x'.repeat(6000),
    });
    expect(hl?.text).toHaveLength(5000);
  });
});

describe('parseIndex', () => {
  test('malformed index degrades to an empty library', () => {
    expect(parseIndex(undefined, NOW)).toEqual({
      schema: 1,
      updatedAt: NOW,
      books: [],
      onDeck: [],
    });
  });

  test('duplicate ids are dropped, onDeck filtered to known unique ids', () => {
    const parsed = parseIndex(
      {
        books: [
          { id: 'a', dir: 'books/a-a', title: 'A' },
          { id: 'a', dir: 'books/dupe', title: 'Dupe' },
          { id: 'b', dir: 'books/b-b', title: 'B' },
        ],
        onDeck: ['b', 'b', 'ghost', 'a'],
      },
      NOW,
    );
    expect(parsed.books.map((b) => b.id)).toEqual(['a', 'b']);
    expect(parsed.onDeck).toEqual(['b', 'a']);
  });

  test('entry without a title falls back to its id for display', () => {
    const parsed = parseIndex({ books: [{ id: 'a', dir: 'books/a-a' }] }, NOW);
    expect(parsed.books[0]?.title).toBe('a');
  });
});
