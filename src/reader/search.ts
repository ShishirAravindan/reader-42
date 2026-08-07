// In-book search (parity H5), fixing both halves of the v1 debt (salvage §7):
// matches used to live inside a single text node, so a phrase crossing an
// <em> was invisible, and only the first hit per chapter could be marked.
//
// The fix is to search the CHAPTER's text, not a node's. Two coordinate
// systems meet here:
//
//   raw         every text node's data concatenated in document order — the
//               offsets `annotate.ts` resolves against the chapter wrapper
//               with `{ path: [], offset }`, so a hit becomes a live Range.
//   normalized  the same text with whitespace runs collapsed and lowercased,
//               which is what a reader means by a phrase: source files wrap
//               paragraphs at eighty columns, and "the quick brown" must
//               still be found across that newline.
//
// A per-character map carries offsets back from normalized to raw, so search
// is forgiving about whitespace and case while the DOM work stays exact.

import { resolveBoundaries, unwrapMarks, wrapRange } from './annotate.ts';

/** Enough hits to be a result list; more is a concordance nobody reads. */
export const SEARCH_HIT_CAP = 200;
/** One letter matches everything; two is the shortest useful query. */
export const SEARCH_MIN_QUERY = 2;
/** Characters of context shown either side of a hit. */
export const SNIPPET_CONTEXT = 40;

export interface SearchHit {
  chapter: number;
  /** Raw offsets into the chapter text; what the DOM resolution speaks. */
  start: number;
  end: number;
  /** Display snippet, whitespace-collapsed, split around the match. */
  before: string;
  match: string;
  after: string;
}

export interface SearchResults {
  hits: SearchHit[];
  /** True when the book had more hits than the cap; the list is a prefix. */
  capped: boolean;
}

export const EMPTY_RESULTS: SearchResults = { hits: [], capped: false };

interface NormalizedChapter {
  /** Lowercased, whitespace-collapsed text. */
  text: string;
  /** map[i] is the raw offset of normalized character i. */
  map: number[];
}

/**
 * Collapse whitespace and lowercase, keeping a raw offset per surviving
 * character. Leading and trailing whitespace is dropped, so the normalized
 * text starts and ends on real characters.
 */
export function normalizeForSearch(raw: string): NormalizedChapter {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    if (/\s/.test(ch)) {
      if (chars.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      chars.push(' ');
      map.push(i);
      pendingSpace = false;
    }
    chars.push(ch.toLowerCase());
    map.push(i);
  }
  return { text: chars.join(''), map };
}

/** Trim a snippet edge at a word boundary, with an ellipsis when it cuts. */
function trimBefore(text: string): string {
  const space = text.indexOf(' ');
  if (space <= 0) return text;
  return `…${text.slice(space + 1)}`;
}

function trimAfter(text: string): string {
  const space = text.lastIndexOf(' ');
  if (space < 0 || space === text.length - 1) return text;
  return `${text.slice(0, space)}…`;
}

export interface BookSearch {
  search(query: string): SearchResults;
}

/**
 * A search over one open book. The normalized form of each chapter is built
 * on first use and kept, so typing into the search box re-scans strings that
 * are already prepared rather than re-flattening the book per keystroke.
 */
export function createBookSearch(
  chapterCount: number,
  chapterText: (chapter: number) => string,
): BookSearch {
  const cache = new Map<number, NormalizedChapter>();
  const normalized = (chapter: number): NormalizedChapter => {
    const seen = cache.get(chapter);
    if (seen) return seen;
    const built = normalizeForSearch(chapterText(chapter));
    cache.set(chapter, built);
    return built;
  };

  return {
    search(query: string): SearchResults {
      const needle = normalizeForSearch(query).text;
      if (needle.length < SEARCH_MIN_QUERY) return EMPTY_RESULTS;
      const hits: SearchHit[] = [];
      let capped = false;
      for (let chapter = 0; chapter < chapterCount && !capped; chapter++) {
        const { text, map } = normalized(chapter);
        let from = 0;
        for (;;) {
          const at = text.indexOf(needle, from);
          if (at < 0) break;
          const endIndex = at + needle.length;
          const rawStart = map[at];
          const rawEnd = map[endIndex - 1];
          if (rawStart === undefined || rawEnd === undefined) break;
          hits.push({
            chapter,
            start: rawStart,
            end: rawEnd + 1,
            before: trimBefore(text.slice(Math.max(at - SNIPPET_CONTEXT, 0), at)),
            match: text.slice(at, endIndex),
            after: trimAfter(text.slice(endIndex, endIndex + SNIPPET_CONTEXT)),
          });
          // Push first, then check: finding one hit PAST the cap is what
          // makes "capped" exactly true, never merely "we stopped counting".
          if (hits.length > SEARCH_HIT_CAP) {
            hits.pop();
            capped = true;
            break;
          }
          from = endIndex; // non-overlapping, like every reader expects
        }
      }
      return { hits, capped };
    },
  };
}

// --- find marks on the page ---

/** The temporary overlay class; locator.ts already treats it as invisible. */
export const FIND_MARK_CLASS = 'find-hit';
const FLASH_CLASS = 'hl-flash';
const FLASH_MS = 1000;

/**
 * Mark the hits belonging to the rendered chapter. Hits address the wrapper
 * itself (path []) with raw offsets, which is exactly what `resolveBoundaries`
 * resolves; a hit that no longer resolves is silently skipped, never a crash.
 * Returns how many were marked.
 *
 * The whole result list is passed in and filtered here, on purpose: a mark is
 * addressed by its index in that list, so the index stays stable while the
 * reader moves between chapters. Filtering outside would renumber the marks —
 * and offsets are per-chapter, so a hit from elsewhere in the book would
 * resolve against this chapter's text and light up the wrong words.
 */
export function applyFindMarks(wrapper: HTMLElement, hits: SearchHit[], chapter: number): number {
  let marked = 0;
  for (const [index, hit] of hits.entries()) {
    if (hit.chapter !== chapter) continue;
    const range = resolveBoundaries(
      wrapper,
      { path: [], offset: hit.start },
      { path: [], offset: hit.end },
    );
    if (!range) continue;
    const marks = wrapRange(wrapper, range, (doc) => {
      const mark = doc.createElement('mark');
      mark.className = FIND_MARK_CLASS;
      mark.dataset.find = String(index);
      return mark;
    });
    if (marks.length > 0) marked += 1;
  }
  return marked;
}

/** Remove every find mark and re-fuse the text nodes (as removal does). */
export function clearFindMarks(wrapper: HTMLElement): void {
  unwrapMarks(wrapper, `mark.${FIND_MARK_CLASS}`);
}

export function findMarks(wrapper: HTMLElement, index: number): HTMLElement[] {
  return Array.from(
    wrapper.querySelectorAll<HTMLElement>(`mark.${FIND_MARK_CLASS}[data-find="${index}"]`),
  );
}

/** Briefly pulse one hit after jumping to it; purely visual, CSS-driven. */
export function flashFindMark(wrapper: HTMLElement, index: number): void {
  const marks = findMarks(wrapper, index);
  for (const mark of marks) {
    mark.classList.remove(FLASH_CLASS);
    void mark.offsetWidth; // restart the animation when re-flashing
    mark.classList.add(FLASH_CLASS);
  }
  setTimeout(() => {
    for (const mark of marks) mark.classList.remove(FLASH_CLASS);
  }, FLASH_MS);
}
