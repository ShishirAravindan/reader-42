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
 * A readable excerpt of `text` starting at a raw offset: whitespace-collapsed,
 * cut at a word boundary, with an ellipsis when the text runs on. Used by the
 * bookmark rows and the Page Flip preview — both need to show WHERE a place is
 * without rendering the chapter it lives in.
 */
export function excerptAt(text: string, offset: number, maxChars: number): string {
  const from = Math.min(Math.max(offset, 0), text.length);
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
 * Flattened-character offset of the element with `id` inside `root`, i.e.
 * the length of all flattened text strictly before it in document order.
 * Null when the id doesn't resolve.
 */
export function charsBeforeId(root: Element, id: string): number | null {
  let raw = '';
  let found = false;
  const walk = (node: Node): void => {
    if (found) return;
    if (node.nodeType === 1 /* element */ && (node as Element).getAttribute('id') === id) {
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
