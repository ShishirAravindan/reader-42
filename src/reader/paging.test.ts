import { describe, expect, test } from 'bun:test';
import { columnGeometry, minSidePad, pageCount, pageIndexFor } from './paging.ts';

const MEASURE = 38 * 16; // the renderer's 38rem measure at the default rem
const ROOT_FONT_SIZE = 16; // default browser root font-size
const OLD_FLAT_MIN_SIDE_PAD_PX = 24; // what the floor used to be, unconditionally

describe('columnGeometry', () => {
  test('invariants hold across phone-to-desktop widths', () => {
    for (let width = 320; width <= 2400; width += 16) {
      const { columnWidth, gap, sidePad } = columnGeometry(width, MEASURE, ROOT_FONT_SIZE);
      // The load-bearing one: stride === clientWidth exactly, no drift.
      expect(columnWidth + gap).toBe(width);
      expect(columnWidth).toBeLessThanOrEqual(MEASURE);
      expect(columnWidth).toBeGreaterThan(0);
      expect(sidePad).toBe(gap / 2);
      // Float rounding can put sidePad a hair under the floor when the
      // measure is the binding constraint right at the crossover width.
      expect(sidePad).toBeGreaterThan(minSidePad(width, ROOT_FONT_SIZE) - 1e-9);
    }
  });

  test('narrow phone viewports get a floor well below the old flat 24px', () => {
    const phone = columnGeometry(375, MEASURE, ROOT_FONT_SIZE);
    // clamp(0.5rem, 4vw, 1rem) at 375px width and a 16px root: 4vw = 15px,
    // which sits between the 8px min and 16px max, so it wins the clamp.
    expect(phone.sidePad).toBeCloseTo(0.04 * 375, 5);
    expect(phone.sidePad).toBeLessThan(OLD_FLAT_MIN_SIDE_PAD_PX);
  });

  test('the floor still caps at a sensible maximum on wide viewports', () => {
    // Past 25rem of width, 4vw would blow past 1rem; the clamp holds there.
    expect(minSidePad(2000, ROOT_FONT_SIZE)).toBe(ROOT_FONT_SIZE);
    const wide = columnGeometry(2400, MEASURE, ROOT_FONT_SIZE);
    // The measure is still the binding constraint well before the floor's
    // own cap would matter, so wide screens cap at the measure, as before.
    expect(wide.columnWidth).toBe(MEASURE);
    expect(wide.sidePad).toBe((2400 - MEASURE) / 2);
  });

  test('the floor scales with the root font-size, for readers who bump it', () => {
    // At this width the 4vw preferred value (6px) is below the 0.5rem min for
    // both roots, so the min itself is what's binding, and it must move with
    // the root font-size (16px root -> 8px min; 24px root -> 12px min).
    const base = columnGeometry(150, MEASURE, 16);
    const bumped = columnGeometry(150, MEASURE, 24);
    expect(bumped.sidePad).toBeGreaterThan(base.sidePad);
  });

  test('degenerate widths still produce a positive column', () => {
    for (const width of [0, 1, 10, 47]) {
      const { columnWidth, gap } = columnGeometry(width, MEASURE, ROOT_FONT_SIZE);
      expect(columnWidth).toBeGreaterThan(0);
      expect(columnWidth + gap).toBe(Math.max(width, 1));
    }
  });
});

describe('minSidePad', () => {
  test('clamps between 0.5rem and 1rem around a 4vw preferred value', () => {
    expect(minSidePad(100, 16)).toBe(8); // 4vw (4px) below the 0.5rem min
    expect(minSidePad(375, 16)).toBeCloseTo(15, 5); // 4vw in range
    expect(minSidePad(2000, 16)).toBe(16); // 4vw (80px) above the 1rem max
  });
});

describe('pageCount', () => {
  test('recovers the exact page count whether or not trailing padding is reported', () => {
    for (let width = 320; width <= 2400; width += 160) {
      const { gap, sidePad } = columnGeometry(width, MEASURE, ROOT_FONT_SIZE);
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
