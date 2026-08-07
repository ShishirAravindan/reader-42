import { describe, expect, test } from 'bun:test';
import { MIN_SIDE_PAD_PX, columnGeometry, pageCount, pageIndexFor } from './paging.ts';

const MEASURE = 38 * 16; // the renderer's 38rem measure at the default rem

describe('columnGeometry', () => {
  test('invariants hold across phone-to-desktop widths', () => {
    for (let width = 320; width <= 2400; width += 16) {
      const { columnWidth, gap, sidePad } = columnGeometry(width, MEASURE);
      // The load-bearing one: stride === clientWidth exactly, no drift.
      expect(columnWidth + gap).toBe(width);
      expect(columnWidth).toBeLessThanOrEqual(MEASURE);
      expect(columnWidth).toBeGreaterThan(0);
      expect(sidePad).toBe(gap / 2);
      expect(sidePad).toBeGreaterThanOrEqual(MIN_SIDE_PAD_PX);
    }
  });

  test('narrow screens keep the minimum side padding, wide screens cap at the measure', () => {
    const narrow = columnGeometry(320, MEASURE);
    expect(narrow.columnWidth).toBe(320 - 2 * MIN_SIDE_PAD_PX);
    expect(narrow.sidePad).toBe(MIN_SIDE_PAD_PX);
    const wide = columnGeometry(2400, MEASURE);
    expect(wide.columnWidth).toBe(MEASURE);
    expect(wide.sidePad).toBe((2400 - MEASURE) / 2);
  });

  test('degenerate widths still produce a positive column', () => {
    for (const width of [0, 1, 10, 47]) {
      const { columnWidth, gap } = columnGeometry(width, MEASURE);
      expect(columnWidth).toBeGreaterThan(0);
      expect(columnWidth + gap).toBe(Math.max(width, 1));
    }
  });
});

describe('pageCount', () => {
  test('recovers the exact page count whether or not trailing padding is reported', () => {
    for (let width = 320; width <= 2400; width += 160) {
      const { gap, sidePad } = columnGeometry(width, MEASURE);
      for (let pages = 1; pages <= 7; pages++) {
        // Engines report either the last column edge or the full padded extent.
        expect(pageCount(pages * width - sidePad, width, gap)).toBe(pages);
        expect(pageCount(pages * width, width, gap)).toBe(pages);
      }
    }
  });

  test('never reports fewer than one page', () => {
    expect(pageCount(0, 800, 100)).toBe(1);
    expect(pageCount(0, 0, 0)).toBe(1);
    expect(pageCount(500, 800, 100)).toBe(1);
  });
});

describe('pageIndexFor', () => {
  test('rounds to the nearest page and clamps at zero', () => {
    expect(pageIndexFor(0, 800)).toBe(0);
    expect(pageIndexFor(799, 800)).toBe(1);
    expect(pageIndexFor(1600, 800)).toBe(2);
    expect(pageIndexFor(1201, 800)).toBe(2);
    expect(pageIndexFor(-40, 800)).toBe(0);
    expect(pageIndexFor(100, 0)).toBe(0);
  });
});
