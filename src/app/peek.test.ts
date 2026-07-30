// Chapter-skip arithmetic for the Page Flip peek. Pure: the slider's chapter
// jumps must land on chapter starts and must never offer an empty chapter.

import { describe, expect, test } from 'bun:test';
import { LOCATION_SPAN } from '../reader/metrics.ts';
import { chapterSkip, chapterStartLocations } from './peek.ts';

describe('chapterStartLocations', () => {
  test('the first chapter starts at location 1', () => {
    expect(chapterStartLocations([500, 500])[0]).toBe(1);
  });

  test('each later chapter starts after the ones before it', () => {
    const starts = chapterStartLocations([LOCATION_SPAN * 3, LOCATION_SPAN * 2]);
    expect(starts).toEqual([1, 4]);
  });
});

describe('chapterSkip', () => {
  const chars = [LOCATION_SPAN * 3, LOCATION_SPAN * 2, LOCATION_SPAN * 4]; // starts 1, 4, 6

  test('skips forward to the next chapter start', () => {
    expect(chapterSkip(chars, 1, 'next')).toBe(4);
    expect(chapterSkip(chars, 4, 'next')).toBe(6);
  });

  test('skips back to the previous chapter start', () => {
    expect(chapterSkip(chars, 6, 'prev')).toBe(4);
    expect(chapterSkip(chars, 5, 'prev')).toBe(4);
  });

  test('returns null at the ends so the arrows can disable', () => {
    expect(chapterSkip(chars, 6, 'next')).toBeNull();
    expect(chapterSkip(chars, 1, 'prev')).toBeNull();
  });

  test('an empty chapter is never a destination', () => {
    // Chapter 1 has no text: skipping from chapter 0 must reach chapter 2.
    const withEmpty = [LOCATION_SPAN * 2, 0, LOCATION_SPAN * 2];
    expect(chapterSkip(withEmpty, 1, 'next')).toBe(3);
  });
});
