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
import type { PageTarget } from '../epub/types.ts';
import { findBody, parseChapterDoc } from './render.ts';

/** One location = this many characters of flattened chapter text. */
export const LOCATION_SPAN = 128;

export interface BookMetrics {
  /** Flattened text length per spine chapter. */
  chapterChars: number[];
  totalChars: number;
  /** Characters in all chapters before `chapter`. */
  charsBefore(chapter: number): number;
  /** 1-based linear location for a place, as in "Location X of Y". */
  locationOf(chapter: number, fraction: number): number;
  totalLocations: number;
}

export function bookMetrics(book: Book): BookMetrics {
  const chapterChars = book.chapters.map((chapter) => {
    const resource = book.resolveResource(chapter.path);
    if (!resource) return 0;
    return flattenedLength(new TextDecoder().decode(resource.bytes));
  });

  const prefix: number[] = [0];
  for (const chars of chapterChars) prefix.push((prefix[prefix.length - 1] ?? 0) + chars);
  const totalChars = prefix[prefix.length - 1] ?? 0;
  const totalLocations = Math.max(1, Math.ceil(totalChars / LOCATION_SPAN));

  const charsBefore = (chapter: number): number => {
    const i = Math.min(Math.max(chapter, 0), chapterChars.length);
    return prefix[i] ?? 0;
  };

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
  };
}

/** Length of the chapter's flattened text: textContent, whitespace-collapsed. */
function flattenedLength(html: string): number {
  const body = findBody(parseChapterDoc(html));
  return flattenText(body.textContent ?? '').length;
}

/** The canonical flattening: collapse whitespace runs to single spaces, trim. */
export function flattenText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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
  const bodies = new Map<number, Element>();
  const bodyFor = (chapter: number): Element | null => {
    const cached = bodies.get(chapter);
    if (cached) return cached;
    const path = book.chapters[chapter]?.path;
    const resource = path ? book.resolveResource(path) : null;
    if (!resource) return null;
    const body = findBody(parseChapterDoc(new TextDecoder().decode(resource.bytes)));
    bodies.set(chapter, body);
    return body;
  };

  const anchors: PageAnchor[] = [];
  let floor = 0; // monotonicity clamp
  for (const target of book.pageList) {
    const chapter = book.chapterIndexByPath(target.path);
    if (chapter < 0) continue;
    let offset = 0;
    if (target.fragment) {
      const body = bodyFor(chapter);
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
