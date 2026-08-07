// Structural locators: where you are, expressed as document structure.
//
// A PositionAnchor (see library/types.ts) is a child-index path from the
// chapter wrapper to the topmost visible element plus how far into that
// element the viewport sits. Paths count structural children only: overlay
// <mark> wrappers (highlights, find hits) are presentation, and a locator
// captured in an already-marked paragraph must serialize as if they don't
// exist, or it never resolves again after reload.
//
// Anchors are axis-independent: captured against vertical scroll they resolve
// against horizontal pages and vice versa, which is what makes positions
// survive display-mode switches later.

import type { PositionAnchor } from '../library/types.ts';

export type Axis = 'v' | 'h';

/** Overlay marks are invisible to locator paths. */
export function isOverlayMark(el: Element): boolean {
  return (
    el.tagName === 'MARK' && (el.classList.contains('hl') || el.classList.contains('find-hit'))
  );
}

export function structuralChildren(el: Element): Element[] {
  const kids: Element[] = [];
  for (const kid of Array.from(el.children)) {
    if (isOverlayMark(kid)) continue; // overlay marks contain only text, never elements
    kids.push(kid);
  }
  return kids;
}

/**
 * Document order of two structural paths. An ancestor sorts before its
 * descendants, so anything addressed by a path (highlights, bookmarks, search
 * hits) can be listed in reading order without touching layout.
 */
export function comparePaths(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Element start offset (top or left) in the mount's scroll coordinates. */
export function absoluteStart(el: Element, mount: HTMLElement, axis: Axis): number {
  const rect = el.getBoundingClientRect();
  const mountRect = mount.getBoundingClientRect();
  return axis === 'v'
    ? rect.top - mountRect.top + mount.scrollTop
    : rect.left - mountRect.left + mount.scrollLeft;
}

function boxSize(el: Element, axis: Axis): number {
  const rect = el.getBoundingClientRect();
  return axis === 'v' ? rect.height : rect.width;
}

/**
 * Capture the anchor for the current viewport start. Never call this against
 * a hidden (display:none) viewport: geometry reads zero and the result is
 * garbage.
 */
export function anchorFor(
  wrapper: HTMLElement,
  mount: HTMLElement,
  axis: Axis,
): PositionAnchor | null {
  const scrollPos = axis === 'v' ? mount.scrollTop : mount.scrollLeft;
  if (scrollPos <= 0) return { path: [], ratio: 0 };

  const path: number[] = [];
  let current: Element = wrapper;
  for (;;) {
    const kids = structuralChildren(current);
    // Prefer the kid whose box spans the viewport start; when the start sits
    // in a margin/padding gap between blocks, anchor to the nearest following
    // kid (negative ratio) or, past the last block, to the last kid (>1).
    let spanning = -1;
    let following = -1;
    let last = -1;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      if (!kid) continue;
      last = i;
      const start = absoluteStart(kid, mount, axis);
      if (start > scrollPos) {
        following = i;
        break;
      }
      if (start + boxSize(kid, axis) > scrollPos) {
        spanning = i;
        break;
      }
    }
    if (spanning >= 0) {
      const next = kids[spanning];
      if (!next) break;
      path.push(spanning);
      current = next;
      if (current.children.length === 0) break;
      continue;
    }
    const fallback = following >= 0 ? following : last;
    const next = fallback >= 0 ? kids[fallback] : undefined;
    if (next) {
      path.push(fallback);
      current = next;
    }
    break;
  }

  if (path.length === 0) return { path: [], ratio: 0 };
  const size = boxSize(current, axis);
  const ratio = size > 0 ? (scrollPos - absoluteStart(current, mount, axis)) / size : 0;
  return { path, ratio: Math.min(Math.max(ratio, -1), 2) };
}

/**
 * Resolve an anchor to a scroll offset along the axis, or null for "top of
 * chapter". Cross-axis capture ratios can overshoot, so restore clamps the
 * ratio inside the element.
 */
export function anchorTarget(
  wrapper: HTMLElement,
  mount: HTMLElement,
  anchor: PositionAnchor,
  axis: Axis,
): number | null {
  const path = sanitizePath(anchor.path);
  if (!path) return null;
  let el: Element = wrapper;
  for (const index of path) {
    const kid = structuralChildren(el)[index];
    if (!kid) break;
    el = kid;
  }
  if (el === wrapper) return null;
  const ratio = clampRatio(anchor.ratio);
  return absoluteStart(el, mount, axis) + ratio * boxSize(el, axis);
}

/**
 * Element at a structural path, or null when the path no longer resolves.
 * Takes any Element: paths captured against a live chapter wrapper resolve
 * just as well against the same chapter parsed offline (bookmark snippets,
 * peek excerpts), because the structure is the same either way.
 */
export function elementAtPath(wrapper: Element, path: number[]): Element | null {
  const clean = sanitizePath(path);
  if (!clean) return null;
  let el: Element = wrapper;
  for (const index of clean) {
    const kid = structuralChildren(el)[index];
    if (!kid) return null;
    el = kid;
  }
  return el;
}

/**
 * Positions are persisted JSON that may be old, hand-edited, or written by
 * another device's future version. A path must be non-negative integer steps;
 * anything else degrades to "top of chapter" rather than resolving to garbage.
 */
function sanitizePath(path: unknown): number[] | null {
  if (!Array.isArray(path)) return null;
  const out: number[] = [];
  for (const step of path) {
    if (!Number.isInteger(step) || step < 0) return null;
    out.push(step);
  }
  return out;
}

/** Clamp a persisted ratio into the element; a non-finite ratio degrades to 0. */
export function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
}
