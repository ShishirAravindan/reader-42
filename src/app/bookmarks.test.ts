import { describe, expect, test } from 'bun:test';
import type { Bookmark } from '../library/types.ts';
import { bookmarkDate, bookmarkOnPage, sortBookmarks } from './bookmarks.ts';

const T = (n: number): string => `2026-07-1${n}T10:00:00.000Z`;

function bm(id: string, chapter: number, path: number[], ratio = 0, createdAt = T(1)): Bookmark {
  return { id, chapter, anchor: { path, ratio }, createdAt };
}

describe('bookmarkOnPage', () => {
  const marks = [bm('a', 1, [2]), bm('b', 1, [9]), bm('c', 2, [2])];

  test('only a bookmark in THIS chapter and on THIS page counts', () => {
    const onPath9 = (b: Bookmark): boolean => b.anchor.path[0] === 9;
    expect(bookmarkOnPage(marks, 1, onPath9)?.id).toBe('b');
    expect(bookmarkOnPage(marks, 2, onPath9)).toBeNull();
  });

  test('the chapter test comes first: another chapter never matches', () => {
    expect(bookmarkOnPage(marks, 3, () => true)).toBeNull();
  });

  test('two bookmarks on one page (two devices) resolve to the earliest', () => {
    const both = [bm('late', 1, [2], 0, T(5)), bm('early', 1, [2], 0, T(2))];
    expect(bookmarkOnPage(both, 1, () => true)?.id).toBe('early');
  });

  test('no bookmarks at all is simply null', () => {
    expect(bookmarkOnPage([], 0, () => true)).toBeNull();
  });
});

describe('sortBookmarks', () => {
  test('reading order: chapter, then path, then ratio', () => {
    const out = sortBookmarks([
      bm('d', 2, [1]),
      bm('c', 1, [9], 0.5),
      bm('b', 1, [9], 0.1),
      bm('a', 1, [3]),
    ]);
    expect(out.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('does not mutate its input', () => {
    const input = [bm('b', 2, [1]), bm('a', 1, [1])];
    sortBookmarks(input);
    expect(input.map((b) => b.id)).toEqual(['b', 'a']);
  });
});

describe('bookmarkDate', () => {
  test('renders a short human date', () => {
    expect(bookmarkDate('2026-07-12T10:00:00.000Z')).toBe('12 Jul 2026');
  });

  test('an unparseable clock renders as nothing, never as "Invalid Date"', () => {
    expect(bookmarkDate('not a date')).toBe('');
  });
});
