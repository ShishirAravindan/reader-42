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

/** Text never touches the screen edge, even on narrow phones. */
export const MIN_SIDE_PAD_PX = 24;

export function columnGeometry(clientWidth: number, measurePx: number): ColumnGeometry {
  const width = Math.max(clientWidth, 1);
  let columnWidth = Math.min(measurePx, width - 2 * MIN_SIDE_PAD_PX);
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
