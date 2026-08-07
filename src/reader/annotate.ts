// Highlight anatomy: DOM ranges ↔ structural boundaries, and mark overlays.
//
// A highlight boundary is an element path (structural children only, the same
// coordinate system as locator.ts) plus a character offset into that element's
// flattened text — the concatenation of its text nodes with overlay marks
// invisible. Both directions treat marks as transparent (salvage §1): a range
// serialized inside an already-marked paragraph must produce the same
// boundaries as it would against the pristine DOM, or the second highlight in
// a paragraph never resolves again after reload.
//
// Application wraps EACH intersecting text-node segment in its own <mark>;
// a single surroundContents throws the moment a range crosses an element
// boundary (a real bug once). Removal unwraps every segment and normalize()s
// so the DOM returns to its pre-highlight byte shape.

import {
  HIGHLIGHT_TEXT_CAP,
  type HighlightBoundary,
  type HighlightColor,
} from '../library/types.ts';
import { elementAtPath, isOverlayMark, structuralChildren } from './locator.ts';
import { flattenText } from './metrics.ts';

export interface SerializedRange {
  start: HighlightBoundary;
  end: HighlightBoundary;
  /** The highlighted text, whitespace-collapsed, capped. */
  text: string;
}

/** Class the flash animation rides on; removed when the animation ends. */
export const FLASH_CLASS = 'hl-flash';
const FLASH_MS = 1000;

// --- text-node walking, marks transparent ---

/** All text nodes under `el` in document order. Text inside overlay marks
 * counts toward its structural ancestor: marks contain only text, so a plain
 * descendant walk already sees through them. Snapshotted into an array so
 * callers may mutate the tree while iterating. */
function textNodesUnder(el: Element): Text[] {
  const out: Text[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 3 /* text */) {
      out.push(node as Text);
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(el);
  return out;
}

/** Flattened-text offset of a DOM point inside `el`, or null when the point
 * is not under `el`. Element-container points (child-index offsets) land on
 * the boundary before that child; points past all text land at the end. */
function pointOffsetIn(el: Element, container: Node, offset: number): number | null {
  if (!(el === container || el.contains(container))) return null;
  const probe = el.ownerDocument.createRange();
  let acc = 0;
  for (const t of textNodesUnder(el)) {
    probe.selectNodeContents(t);
    const cmp = probe.comparePoint(container, offset);
    if (cmp < 0) return acc; // point before this text node
    if (cmp === 0) return acc + offset; // inside: container IS this text node
    acc += t.data.length;
  }
  return acc; // after all text (e.g. the end of the element)
}

/** The text node + local offset for a flattened offset, or null when stale
 * (offset past the element's text). Marks in the tree are transparent: their
 * text counts toward the structural element's flattened text. */
function textPointAt(el: Element, offset: number): { node: Text; offset: number } | null {
  let acc = 0;
  for (const t of textNodesUnder(el)) {
    if (offset <= acc + t.data.length) return { node: t, offset: offset - acc };
    acc += t.data.length;
  }
  return null;
}

// --- structural addressing ---

/** Nearest structural element for a DOM node: its element (or parent for
 * text), climbed OUT of any overlay marks (salvage §1). */
function structuralElementFor(node: Node, wrapper: HTMLElement): Element | null {
  let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement;
  while (el && isOverlayMark(el)) el = el.parentElement;
  if (!el || (el !== wrapper && !wrapper.contains(el))) return null;
  return el;
}

/** Structural-children index path from the wrapper down to `el`. */
function pathTo(wrapper: HTMLElement, el: Element): number[] | null {
  const path: number[] = [];
  let cur: Element = el;
  while (cur !== wrapper) {
    const parent = cur.parentElement;
    if (!parent) return null;
    const index = structuralChildren(parent).indexOf(cur);
    if (index < 0) return null; // cur is itself a mark or otherwise unaddressable
    path.unshift(index);
    cur = parent;
  }
  return path;
}

// --- range ↔ boundaries ---

/**
 * Serialize a live Range into structural boundaries. Null for collapsed or
 * degenerate ranges and for ranges outside the wrapper. Safe to call against
 * a marked-up chapter: boundaries always describe the mark-free structure.
 */
export function serializeRange(wrapper: HTMLElement, range: Range): SerializedRange | null {
  if (range.collapsed) return null;
  const startEl = structuralElementFor(range.startContainer, wrapper);
  const endEl = structuralElementFor(range.endContainer, wrapper);
  if (!startEl || !endEl) return null;
  const startPath = pathTo(wrapper, startEl);
  const endPath = pathTo(wrapper, endEl);
  if (!startPath || !endPath) return null;
  const startOffset = pointOffsetIn(startEl, range.startContainer, range.startOffset);
  const endOffset = pointOffsetIn(endEl, range.endContainer, range.endOffset);
  if (startOffset === null || endOffset === null) return null;
  if (startEl === endEl && startOffset >= endOffset) return null;
  const text = flattenText(range.toString()).slice(0, HIGHLIGHT_TEXT_CAP);
  if (!text) return null;
  return {
    start: { path: startPath, offset: startOffset },
    end: { path: endPath, offset: endOffset },
    text,
  };
}

/**
 * Resolve persisted boundaries back to a live Range, tolerating overlay marks
 * in the tree. Null when stale (missing element, offset past the text): a
 * stale highlight silently doesn't render — it never crashes or mis-renders.
 */
export function resolveBoundaries(
  wrapper: HTMLElement,
  start: HighlightBoundary,
  end: HighlightBoundary,
): Range | null {
  const startEl = elementAtPath(wrapper, start.path);
  const endEl = elementAtPath(wrapper, end.path);
  if (!startEl || !endEl) return null;
  const s = textPointAt(startEl, start.offset);
  const e = textPointAt(endEl, end.offset);
  if (!s || !e) return null;
  const range = wrapper.ownerDocument.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    return null;
  }
  if (range.collapsed) return null;
  return range;
}

// --- mark application ---

/** True when the text node overlaps the range by at least a boundary. */
function intersectsRange(range: Range, t: Text): boolean {
  return range.comparePoint(t, t.data.length) >= 0 && range.comparePoint(t, 0) <= 0;
}

/**
 * Wrap every text-node segment the range intersects in its own
 * `<mark class="hl hl-<color>" data-hl="<id>">`. Whitespace-only segments
 * (block gaps) are left alone; unwrappable segments are skipped rather than
 * failing the whole highlight (salvage §1). Marks wrap only text, so locator
 * paths and other highlights' boundaries stay valid. A note shows a marker
 * glyph via CSS ::after on the last segment — a pseudo-element, so the
 * "marks contain only text" invariant holds.
 */
export function applyHighlight(
  wrapper: HTMLElement,
  hl: { id: string; color: HighlightColor; note?: string },
  range: Range,
): void {
  const marks = wrapRange(wrapper, range, (doc) => {
    const mark = doc.createElement('mark');
    mark.className = `hl hl-${hl.color}`;
    mark.dataset.hl = hl.id;
    return mark;
  });
  const lastMark = marks[marks.length - 1];
  if (hl.note && lastMark) lastMark.classList.add('has-note');
}

/**
 * Wrap every text-node segment a range intersects in its own mark element,
 * returning them in document order. Shared by highlights and find hits: both
 * are overlay marks, and both must be applied segment-by-segment for the same
 * reason. `make` builds each wrapper so the caller owns the class and data.
 */
export function wrapRange(
  wrapper: HTMLElement,
  range: Range,
  make: (doc: Document) => HTMLElement,
): HTMLElement[] {
  const doc = wrapper.ownerDocument;
  // Snapshot the segments before mutating: wrapping splits text nodes.
  const segments: { node: Text; start: number; end: number }[] = [];
  for (const t of textNodesUnder(wrapper)) {
    if (!intersectsRange(range, t)) continue;
    const start = t === range.startContainer ? range.startOffset : 0;
    const end = t === range.endContainer ? range.endOffset : t.data.length;
    if (start >= end) continue;
    if (t.data.slice(start, end).trim().length === 0) continue;
    segments.push({ node: t, start, end });
  }
  const marks: HTMLElement[] = [];
  for (const seg of segments) {
    try {
      const target = seg.start > 0 ? seg.node.splitText(seg.start) : seg.node;
      if (seg.end - seg.start < target.data.length) target.splitText(seg.end - seg.start);
      const mark = make(doc);
      target.parentNode?.insertBefore(mark, target);
      mark.appendChild(target);
      marks.push(mark);
    } catch {
      // Skip the unwrappable segment; the rest of the overlay still shows.
    }
  }
  return marks;
}

/**
 * Unwrap every mark matching a selector and normalize() the affected parents,
 * so the DOM returns to its pre-overlay shape and text nodes re-fuse. The
 * shared half of highlight removal and find-mark clearing.
 */
export function unwrapMarks(wrapper: HTMLElement, selector: string): void {
  const parents = new Set<Node>();
  for (const mark of Array.from(wrapper.querySelectorAll<HTMLElement>(selector))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parents.add(parent);
  }
  for (const parent of parents) parent.normalize();
}

/** Every mark segment of a highlight, in document order. */
export function highlightMarks(wrapper: HTMLElement, id: string): HTMLElement[] {
  return Array.from(wrapper.querySelectorAll<HTMLElement>(`mark.hl[data-hl="${id}"]`));
}

/**
 * Unwrap every segment of a highlight and normalize() the affected parents so
 * text nodes re-fuse — the DOM returns to its pre-highlight shape, keeping
 * later serializations against clean structure.
 */
export function removeHighlight(wrapper: HTMLElement, id: string): void {
  unwrapMarks(wrapper, `mark.hl[data-hl="${id}"]`);
}

/** Briefly pulse a highlight (jump-and-flash); purely visual, CSS-driven. */
export function flashHighlight(wrapper: HTMLElement, id: string): void {
  const marks = highlightMarks(wrapper, id);
  for (const mark of marks) {
    mark.classList.remove(FLASH_CLASS);
    void mark.offsetWidth; // restart the animation when re-flashing
    mark.classList.add(FLASH_CLASS);
  }
  setTimeout(() => {
    for (const mark of marks) mark.classList.remove(FLASH_CLASS);
  }, FLASH_MS);
}
