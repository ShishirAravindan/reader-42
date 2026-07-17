import { describe, expect, test } from 'bun:test';
import type { ReadingPosition } from '../library/types.ts';
import { positionKey } from './controller.ts';

const at = (chapter: number, path: number[], ratio: number): ReadingPosition => ({
  chapter,
  anchor: { path, ratio },
  scroll: 0,
  updatedAt: '2026-07-14T00:00:00.000Z',
});

describe('positionKey', () => {
  test('ignores scroll pixels and the timestamp', () => {
    const a = { ...at(1, [39], 0.6), scroll: 100, updatedAt: 'a' };
    const b = { ...at(1, [39], 0.6), scroll: 999, updatedAt: 'b' };
    expect(positionKey(a)).toBe(positionKey(b));
  });

  test('distinguishes chapter, path, and ratio moves', () => {
    const base = positionKey(at(1, [39], 0.6));
    expect(positionKey(at(2, [39], 0.6))).not.toBe(base);
    expect(positionKey(at(1, [40], 0.6))).not.toBe(base);
    expect(positionKey(at(1, [39], 0.9))).not.toBe(base);
  });

  test('anchor-less positions collapse to a stable top key', () => {
    const top: ReadingPosition = { chapter: 0, scroll: 0, updatedAt: 'x' };
    expect(positionKey(top)).toBe(positionKey({ ...top, scroll: 50, updatedAt: 'y' }));
  });
});
