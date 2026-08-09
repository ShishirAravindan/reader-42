// Pure page geometry for paged mode (CSS multicolumn). No DOM: these are the
// invariants the renderer applies and the tests pin down, per salvage §2:
// stride (column + gap) must equal the visible width exactly, the column is
// capped at the text measure, and surplus width becomes symmetric margins
// with the wrapper's side padding folded into the gap.

export interface ColumnGeometry {
  columnWidth: number;
  gap: number;
  /** Symmetric margin each side; always gap / 2 so the stride stays exact. */
  sidePad: number;
}

/**
 * Text never touches the screen edge, even on narrow phones. Equivalent to
 * the CSS `clamp(0.5rem, 4vw, 1rem)`: scales with the viewport down to a
 * phone-appropriate minimum, and caps out at a modest value on wide screens.
 * The rem base ties the floor to the root font-size, so a reader who has
 * bumped their OS/browser text size gets a proportionally larger safe edge.
 * This file has no DOM access (see header comment), so the caller resolves
 * rem-to-px once (e.g. via getComputedStyle) and passes it in.
 */
export function minSidePad(clientWidth: number, rootFontSizePx: number): number {
  const min = 0.5 * rootFontSizePx;
  const max = 1 * rootFontSizePx;
  const preferred = 0.04 * clientWidth;
  return Math.min(Math.max(preferred, min), max);
}

export function columnGeometry(
  clientWidth: number,
  measurePx: number,
  rootFontSizePx: number,
): ColumnGeometry {
  const width = Math.max(clientWidth, 1);
  const sidePadFloor = minSidePad(width, rootFontSizePx);
  let columnWidth = Math.min(measurePx, width - 2 * sidePadFloor);
  if (columnWidth < 1) columnWidth = Math.max(width - 2, 1); // degenerate widths
  const gap = width - columnWidth;
  return { columnWidth, gap, sidePad: gap / 2 };
}

/**
 * Page count from the mount's scroll extent. Column overflow ends at the last
 * column's right edge: the trailing side pad (gap / 2) is not part of it, so
 * add it back before dividing. An engine that does include trailing padding
 * still rounds to the same count, because gap / 2 < stride / 2 always.
 */
export function pageCount(scrollWidth: number, clientWidth: number, gap: number): number {
  if (clientWidth <= 0) return 1;
  return Math.max(1, Math.round((scrollWidth + gap / 2) / clientWidth));
}

/** Which page a scroll offset sits on; snaps to the nearest page start. */
export function pageIndexFor(scrollLeft: number, stride: number): number {
  if (stride <= 0) return 0;
  return Math.max(0, Math.round(scrollLeft / stride));
}
