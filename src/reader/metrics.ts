// Book text metrics: flattened character counts per chapter, computed once
// per open, and the linear location index derived from them (parity B1).
//
// Constraints: locations are device-independent — derived from character
// counts of the flattened chapter text, never from layout — so "Location X
// of Y" is stable across font, size, margin, and display-mode changes. One
// location is a fixed span of text (LOCATION_SPAN chars), 1-based like
// Kindle's. Parsing costs milliseconds per chapter and runs once per open;
// nothing here is called per position update except the pure arithmetic.

import type { Book } from '../epub/book.ts';
import type { PositionAnchor } from '../library/types.ts';
import { clampRatio, elementAtPath, isOverlayMark } from './locator.ts';
import { findBody, parseChapterDoc, sanitizeContent } from './render.ts';

/** One location = this many characters of flattened chapter text. */
export const LOCATION_SPAN = 128;

/** A place in the book as the reader's own coordinates: chapter + how far in. */
export interface BookPlace {
  chapter: number;
  fraction: number;
}

export interface BookMetrics {
  /** Flattened text length per spine chapter. */
  chapterChars: number[];
  totalChars: number;
  /** Characters in all chapters before `chapter`. */
  charsBefore(chapter: number): number;
  /** 1-based linear location for a place, as in "Location X of Y". */
  locationOf(chapter: number, fraction: number): number;
  totalLocations: number;
  /** Inverse of the location index: where a global character offset sits. */
  placeAtChar(globalChar: number): BookPlace;
  /** Inverse of locationOf: the place a 1-based location names. */
  placeAtLocation(location: number): BookPlace;
  /**
   * The chapter's text nodes concatenated raw, in document order — the exact
   * string annotate.ts addresses with `{ path: [], offset }` against the
   * rendered wrapper. Search hits and peek excerpts live in this coordinate
   * system; the whitespace-collapsed lengths above are a different one, used
   * only for locations and progress.
   */
  chapterText(chapter: number): string;
  /** Parsed, sanitized chapter body; structural paths resolve against it. */
  chapterBody(chapter: number): Element | null;
}

export function bookMetrics(book: Book): BookMetrics {
  const rawText: string[] = [];
  const chapterChars = book.chapters.map((chapter) => {
    const resource = book.resolveResource(chapter.path);
    if (!resource) {
      rawText.push('');
      return 0;
    }
    const body = parseBody(new TextDecoder().decode(resource.bytes));
    rawText.push(rawTextOf(body));
    return flattenText(body.textContent ?? '').length;
  });

  const prefix: number[] = [0];
  for (const chars of chapterChars) prefix.push((prefix[prefix.length - 1] ?? 0) + chars);
  const totalChars = prefix[prefix.length - 1] ?? 0;
  const totalLocations = Math.max(1, Math.ceil(totalChars / LOCATION_SPAN));

  const charsBefore = (chapter: number): number => {
    const i = Math.min(Math.max(chapter, 0), chapterChars.length);
    return prefix[i] ?? 0;
  };

  // Bodies are re-parsed on demand rather than retained: the eager pass above
  // needs one parse per chapter for its counts, but keeping every chapter's
  // DOM resident for a whole book would cost far more than the strings do.
  const bodies = new Map<number, Element>();

  return {
    chapterChars,
    totalChars,
    totalLocations,
    charsBefore,
    locationOf(chapter: number, fraction: number): number {
      const chars = chapterChars[chapter] ?? 0;
      const offset = charsBefore(chapter) + fraction * chars;
      const loc = Math.floor(offset / LOCATION_SPAN) + 1;
      return Math.min(Math.max(loc, 1), totalLocations);
    },
    placeAtChar(globalChar: number): BookPlace {
      const target = Math.min(Math.max(globalChar, 0), totalChars);
      // The last chapter that starts at or before the offset, skipping empty
      // ones so a place never lands in a chapter with nothing to show.
      let chapter = 0;
      for (let i = 0; i < chapterChars.length; i++) {
        if ((prefix[i] ?? 0) <= target && (chapterChars[i] ?? 0) > 0) chapter = i;
        if ((prefix[i] ?? 0) > target) break;
      }
      const chars = chapterChars[chapter] ?? 0;
      const into = target - (prefix[chapter] ?? 0);
      return { chapter, fraction: chars > 0 ? Math.min(Math.max(into / chars, 0), 1) : 0 };
    },
    placeAtLocation(location: number): BookPlace {
      const loc = Math.min(Math.max(Math.floor(location), 1), totalLocations);
      return this.placeAtChar((loc - 1) * LOCATION_SPAN);
    },
    chapterText: (chapter: number): string => rawText[chapter] ?? '',
    chapterBody(chapter: number): Element | null {
      const cached = bodies.get(chapter);
      if (cached) return cached;
      const path = book.chapters[chapter]?.path;
      const resource = path ? book.resolveResource(path) : null;
      if (!resource) return null;
      const body = parseBody(new TextDecoder().decode(resource.bytes));
      bodies.set(chapter, body);
      return body;
    },
  };
}

/**
 * One chapter body, parsed and sanitized exactly as the renderer will show it
 * — active content is stripped there too, so text the reader never sees never
 * counts toward offsets or lengths.
 */
function parseBody(html: string): Element {
  const body = findBody(parseChapterDoc(html));
  sanitizeContent(body);
  return body;
}

/** Text-node data concatenated in document order; no whitespace collapsing. */
function rawTextOf(root: Element): string {
  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === 3 /* text */) {
      out += node.nodeValue ?? '';
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(root);
  return out;
}

/**
 * Raw text offset of an element inside `root`: how much text-node data comes
 * strictly before it in document order. Null when the element is not under
 * `root`. Structure in, an offset into chapterText out — no layout anywhere,
 * which is what lets a bookmark or a peek excerpt be resolved without ever
 * rendering the chapter it points at.
 */
export function rawOffsetOfElement(root: Element, target: Element): number | null {
  let offset = 0;
  let found = false;
  const walk = (node: Node): void => {
    if (found) return;
    if (node === target) {
      found = true;
      return;
    }
    if (node.nodeType === 3 /* text */) {
      offset += (node.nodeValue ?? '').length;
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child);
      if (found) return;
    }
  };
  walk(root);
  return found ? offset : null;
}

/** The canonical flattening: collapse whitespace runs to single spaces, trim. */
export function flattenText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Counts flattened characters as text arrives, so a document can be walked
 * once instead of re-flattening a growing prefix at every boundary. `count()`
 * equals `flattenText(everything pushed so far).length` exactly: a whitespace
 * run only spends its single space once a real character follows it, which is
 * how flattenText's trim behaves at both ends.
 */
function flatCounter(): { push(text: string): void; count(): number } {
  let flat = 0;
  let started = false;
  let pendingSpace = false;
  return {
    push(text: string): void {
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i] as string)) {
          if (started) pendingSpace = true;
          continue;
        }
        if (pendingSpace) {
          flat += 1;
          pendingSpace = false;
        }
        started = true;
        flat += 1;
      }
    },
    count: (): number => flat,
  };
}

/**
 * The raw offset that holds a given FLATTENED offset. Locations, progress, and
 * time-left all count flattened characters, while `chapterText` (and so
 * `excerptAt`) speaks raw text-node data; XHTML source is full of indentation
 * that flattening drops, so the two drift apart over a chapter. This walks the
 * raw text counting only the characters flattening keeps, which is what lets a
 * location number resolve to the words actually at it.
 */
export function rawOffsetForFlat(raw: string, flatOffset: number): number {
  if (flatOffset <= 0) return 0;
  let flat = 0;
  let inRun = false;
  // Leading whitespace is trimmed away by flattenText, so it counts for
  // nothing until the first real character.
  let started = false;
  for (let i = 0; i < raw.length; i++) {
    const ws = /\s/.test(raw[i] as string);
    if (ws) {
      if (started && !inRun) {
        flat += 1; // the single space a whitespace run collapses to
        inRun = true;
      }
    } else {
      started = true;
      inRun = false;
      flat += 1;
    }
    if (flat > flatOffset) return i;
  }
  return raw.length;
}

/**
 * A readable excerpt of `text` starting at a raw offset: whitespace-collapsed,
 * cut at a word boundary, with an ellipsis when the text runs on. Used by the
 * bookmark rows and the Page Flip preview — both need to show WHERE a place is
 * without rendering the chapter it lives in.
 */
export function excerptAt(text: string, offset: number, maxChars: number): string {
  let from = Math.min(Math.max(offset, 0), text.length);
  // An offset can land mid-word (a location is a character count, not a word
  // boundary). Starting an excerpt with "ingle viewport" reads like a glitch,
  // so drop the partial word — but only when there really is one: an offset at
  // a word start, or at 0, keeps its first word.
  const precededByText = from > 0 && !/\s/.test(text[from - 1] as string);
  if (precededByText && !/\s/.test(text[from] ?? ' ')) {
    while (from < text.length && !/\s/.test(text[from] as string)) from += 1;
  }
  // Collapse first, then cut: collapsing after would leave a ragged tail.
  const rest = flattenText(text.slice(from, from + maxChars * 2 + 1));
  if (rest.length <= maxChars) return rest;
  const cut = rest.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// --- print page anchors (parity B2) ---

/** A print page's start as a global character offset; the display substrate. */
export interface PageAnchor {
  label: string;
  globalChar: number;
}

/**
 * Map the book's page-list targets onto the location coordinate system:
 * each print page starts at the flattened-character offset of its fragment
 * element. Layout-free like everything here, computed once per open, and
 * clamped monotonic so a sloppy page-list can't make page numbers jump
 * backwards. Targets whose path or fragment doesn't resolve are dropped.
 */
export function pageAnchors(book: Book, metrics: BookMetrics): PageAnchor[] {
  if (book.pageList.length === 0) return [];
  const anchors: PageAnchor[] = [];
  let floor = 0; // monotonicity clamp
  for (const target of book.pageList) {
    const chapter = book.chapterIndexByPath(target.path);
    if (chapter < 0) continue;
    let offset = 0;
    if (target.fragment) {
      const body = metrics.chapterBody(chapter);
      const before = body ? charsBeforeId(body, target.fragment) : null;
      if (before === null) continue;
      offset = Math.min(before, metrics.chapterChars[chapter] ?? 0);
    }
    floor = Math.max(floor, metrics.charsBefore(chapter) + offset);
    anchors.push({ label: target.label, globalChar: floor });
  }
  return anchors;
}

/**
 * Flattened-character offset of the first node `stop` accepts, i.e. the length
 * of all flattened text strictly before it in document order. Null when
 * nothing in `root` matches.
 */
function charsBeforeMatch(root: Element, stop: (node: Node) => boolean): number | null {
  let raw = '';
  let found = false;
  const walk = (node: Node): void => {
    if (found) return;
    if (stop(node)) {
      found = true;
      return;
    }
    if (node.nodeType === 3 /* text */) {
      raw += node.nodeValue ?? '';
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child);
      if (found) return;
    }
  };
  walk(root);
  return found ? flattenText(raw).length : null;
}

/**
 * Flattened-character offset of the element with `id` inside `root`.
 * Null when the id doesn't resolve.
 */
export function charsBeforeId(root: Element, id: string): number | null {
  return charsBeforeMatch(
    root,
    (node) => node.nodeType === 1 && (node as Element).getAttribute('id') === id,
  );
}

/** Flattened-character offset of an element inside `root`; null when outside it. */
export function charsBeforeElement(root: Element, target: Element): number | null {
  return charsBeforeMatch(root, (node) => node === target);
}

/**
 * Where a structural anchor sits, counted in flattened characters of the
 * chapter's text. This is the conversion that keeps everything the reader is
 * TOLD — location, print page, percent, time left — free of layout: the anchor
 * says which element the viewport starts on, and a character count says how
 * far into the chapter that element is. Raise the type size and the anchor
 * still names the same paragraph, so the number does not move; a
 * scroll-extent fraction would, because a fixed-height image becomes a
 * different share of a taller chapter.
 *
 * Null when the anchor's path doesn't resolve against `root`; callers decide
 * what to do without it.
 */
export function charsBeforeAnchor(root: Element, anchor: PositionAnchor): number | null {
  if (anchor.path.length === 0) return 0; // "top of chapter"
  const element = elementAtPath(root, anchor.path);
  if (!element || element === root) return null;
  const before = charsBeforeElement(root, element);
  if (before === null) return null;
  // The ratio is how far into that one element the viewport starts. Inside a
  // single block the only honest reading of it is proportional, and a block is
  // rarely more than a screen tall, so the error is bounded by one paragraph.
  const own = flattenText(element.textContent ?? '').length;
  return before + clampRatio(anchor.ratio) * own;
}

/**
 * The inverse: the structural anchor at a flattened-character offset into
 * `root`. Descends to the element that actually holds those characters, so a
 * jump to a location or a print page lands on the page holding THAT TEXT, at
 * any type size and in either display mode. Going by a share of the scroll
 * extent instead lands short or long by however much the layout disagrees with
 * the text — a whole page at the end of a long chapter, because the paged
 * scroll extent stops at the last page's start.
 */
export function anchorAtChars(root: Element, target: number): PositionAnchor {
  const path: number[] = [];
  let current: Element = root;
  let offset = Math.max(target, 0);
  for (;;) {
    const found = childHolding(current, offset);
    if (!found) break;
    path.push(found.index);
    current = found.element;
    offset = found.into;
  }
  if (path.length === 0) return { path: [], ratio: 0 };
  const own = flattenText(current.textContent ?? '').length;
  return { path, ratio: own > 0 ? Math.min(Math.max(offset / own, 0), 1) : 0 };
}

/**
 * Which structural child of `el` holds the flattened offset, and how far into
 * it the offset sits. Text directly under `el` (and the text inside overlay
 * marks, which paths must not see) still counts toward the offsets, or the
 * coordinates would drift from the ones charsBeforeAnchor reports.
 */
function childHolding(
  el: Element,
  offset: number,
): { index: number; element: Element; into: number } | null {
  const counter = flatCounter();
  let index = -1;
  let last: { index: number; element: Element; into: number } | null = null;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* text */) {
      counter.push(node.nodeValue ?? '');
      continue;
    }
    if (node.nodeType !== 1 /* element */) continue;
    const child = node as Element;
    if (isOverlayMark(child)) {
      counter.push(rawTextOf(child)); // presentation, not structure
      continue;
    }
    index += 1;
    const from = counter.count();
    counter.push(rawTextOf(child));
    const to = counter.count();
    last = { index, element: child, into: Math.max(to - from, 0) };
    if (offset < to) return { index, element: child, into: Math.max(offset - from, 0) };
  }
  // Past the end of the text: the last child, at its end.
  return last;
}
