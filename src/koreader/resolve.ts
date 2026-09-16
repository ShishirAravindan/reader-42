// Locating a KOReader highlight in reader-42's coordinate system.
//
// The sidecar hands us crengine's xpointers, which address crengine's own
// normalized DOM and mean nothing against the tree a browser builds (see
// sdr.ts). What it also hands us is the highlighted TEXT, and text is the one
// thing both engines agree on: it is the book.
//
// So resolution is a text search that yields real locators. For each chapter
// we build a flattened transcript plus, per flattened character, the
// structural element that owns it and the raw offset inside that element —
// exactly the coordinates annotate.ts serializes a live Range into, so a
// resolved highlight is indistinguishable from one made here by hand. It
// renders, it deep-links, it exports.
//
// Two invariants borrowed from the existing reader, both load-bearing:
//   * A boundary's element is the text node's IMMEDIATE parent, climbed out
//     of overlay marks, and its offset counts every text node under that
//     element (annotate.ts: textNodesUnder / pointOffsetIn).
//   * Whitespace is flattened the way metrics.flattenText flattens it, or a
//     needle taken from a device never matches an indented XHTML source.

import { HIGHLIGHT_TEXT_CAP, type Highlight } from '../library/types.ts';
import { isOverlayMark, structuralChildren } from '../reader/locator.ts';
import { flattenText } from '../reader/metrics.ts';
import type { KoAnnotation } from './sdr.ts';

/** Where a resolved highlight came from, so the run can be audited rather
 * than trusted. The hint is crengine's DocFragment index; "scan" means the
 * hint was wrong or absent and the whole book had to be searched. */
export type ResolveVia = 'hint' | 'scan';

export interface Resolved {
  chapter: number;
  start: { path: number[]; offset: number };
  end: { path: number[]; offset: number };
  via: ResolveVia;
  /** True when the same text occurs more than once in the chosen chapter:
   * the first occurrence was taken and it may be the wrong one. */
  ambiguous: boolean;
}

export type ResolveFailure =
  | 'empty-text'
  /** The text is nowhere in the book. A stale highlight, an edited EPUB, or
   * a different edition of the same title. */
  | 'not-found';

export type ResolveOutcome = { ok: true; at: Resolved } | { ok: false; why: ResolveFailure };

// --- the per-chapter transcript ---

interface Point {
  /** Index into `elements`. */
  owner: number;
  /** Raw offset inside that element's concatenated text-node data. */
  offset: number;
}

export interface ChapterIndex {
  /** Flattened text of the whole chapter. */
  text: string;
  /** One entry per character of `text`. */
  points: Point[];
  /** Structural paths, referenced by Point.owner. */
  elements: number[][];
}

/**
 * Build the transcript for one chapter wrapper.
 *
 * The walk records a text node against its immediate parent, which is what
 * makes the resulting offsets the same numbers `serializeRange` would have
 * produced; a nested `<em>` owns its own text, while an overlay `<mark>` is
 * transparent and its text belongs to the element around it.
 */
export function indexChapter(wrapper: Element): ChapterIndex {
  const elements: number[][] = [];
  const keys = new Map<Element, number>();
  const ownerOf = (el: Element, path: number[]): number => {
    const seen = keys.get(el);
    if (seen !== undefined) return seen;
    const id = elements.length;
    elements.push([...path]);
    keys.set(el, id);
    return id;
  };

  let text = '';
  const points: Point[] = [];
  let started = false;
  let pendingSpace = false;

  /** Append one text node's data, flattening as metrics.flattenText does. */
  const emit = (data: string, owner: number, base: number): void => {
    for (let i = 0; i < data.length; i++) {
      const ch = data[i] as string;
      if (/\s/.test(ch)) {
        if (started) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        text += ' ';
        points.push({ owner, offset: base + i });
        pendingSpace = false;
      }
      text += ch;
      points.push({ owner, offset: base + i });
      started = true;
    }
  };

  /** Returns the total raw text length under `el`, and records every text
   * node against the element that owns it. */
  const walk = (el: Element, path: number[]): number => {
    let acc = 0;
    let structuralIndex = 0;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 /* text */) {
        const data = (child as Text).data;
        emit(data, ownerOf(el, path), acc);
        acc += data.length;
        continue;
      }
      if (child.nodeType !== 1) continue;
      const childEl = child as Element;
      if (isOverlayMark(childEl)) {
        // Marks contain only text and are invisible to locators: their text
        // counts toward THIS element and does not consume a structural index.
        for (const grand of Array.from(childEl.childNodes)) {
          if (grand.nodeType !== 3) continue;
          const data = (grand as Text).data;
          emit(data, ownerOf(el, path), acc);
          acc += data.length;
        }
        continue;
      }
      path.push(structuralIndex);
      acc += walk(childEl, path);
      path.pop();
      structuralIndex++;
    }
    return acc;
  };

  walk(wrapper, []);
  return { text, points, elements };
}

// --- searching ---

function locate(index: ChapterIndex, needle: string): { from: number; ambiguous: boolean } | null {
  const from = index.text.indexOf(needle);
  if (from < 0) return null;
  return { from, ambiguous: index.text.indexOf(needle, from + 1) >= 0 };
}

function boundariesAt(
  index: ChapterIndex,
  from: number,
  length: number,
): { start: Resolved['start']; end: Resolved['end'] } | null {
  const first = index.points[from];
  const last = index.points[from + length - 1];
  if (!first || !last) return null;
  const startPath = index.elements[first.owner];
  const endPath = index.elements[last.owner];
  if (!startPath || !endPath) return null;
  return {
    start: { path: startPath, offset: first.offset },
    // Exclusive: one past the last matched character, which is what
    // resolveBoundaries expects on the end side.
    end: { path: endPath, offset: last.offset + 1 },
  };
}

/**
 * Resolve one annotation against the book's chapters.
 *
 * The DocFragment hint is tried first and the whole book second. Recording
 * WHICH won is the point: it is the measurement of how far the one portable
 * component of an xpointer actually carries.
 */
export function resolveAnnotation(
  annotation: KoAnnotation,
  chapters: ChapterIndex[],
): ResolveOutcome {
  const needle = flattenText(annotation.text);
  if (!needle) return { ok: false, why: 'empty-text' };

  const order: { at: number; via: ResolveVia }[] = [];
  const hint = annotation.spineHint;
  if (hint !== null && hint >= 0 && hint < chapters.length) order.push({ at: hint, via: 'hint' });
  for (let i = 0; i < chapters.length; i++) {
    if (i !== hint) order.push({ at: i, via: 'scan' });
  }

  for (const { at, via } of order) {
    const index = chapters[at];
    if (!index) continue;
    const found = locate(index, needle);
    if (!found) continue;
    const bounds = boundariesAt(index, found.from, needle.length);
    if (!bounds) continue;
    return {
      ok: true,
      at: { chapter: at, ...bounds, via, ambiguous: found.ambiguous },
    };
  }
  return { ok: false, why: 'not-found' };
}

/** A resolved annotation as a reader-42 highlight. Ids are derived from the
 * sidecar rather than random, so re-importing the same sidecar merges by union
 * instead of growing a duplicate every time (decisions.md 2026-08-01). */
export function toHighlight(annotation: KoAnnotation, at: Resolved, id: string): Highlight {
  return {
    id,
    chapter: at.chapter,
    start: at.start,
    end: at.end,
    text: flattenText(annotation.text).slice(0, HIGHLIGHT_TEXT_CAP),
    color: annotation.color,
    ...(annotation.note !== undefined ? { note: annotation.note } : {}),
    createdAt: annotation.createdAt,
  };
}
