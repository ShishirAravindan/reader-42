// Search's contract is the two halves of the v1 debt (salvage §7): a phrase
// must be found across inline tags and source newlines, and EVERY occurrence
// must be found, not just the first in a chapter.

import { describe, expect, test } from 'bun:test';
import {
  SEARCH_HIT_CAP,
  SNIPPET_CONTEXT,
  applyFindMarks,
  clearFindMarks,
  createBookSearch,
  findMarks,
  normalizeForSearch,
} from './search.ts';

function wrapperWith(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<div id="w">${html}</div>`, 'text/html');
  const wrapper = doc.getElementById('w');
  if (!wrapper) throw new Error('no wrapper');
  return wrapper as HTMLElement;
}

/** The raw text search speaks: every text node concatenated in order. */
function rawTextOf(el: Element): string {
  return el.textContent ?? '';
}

describe('normalizeForSearch', () => {
  test('collapses whitespace and lowercases, keeping raw offsets', () => {
    const { text, map } = normalizeForSearch('  The\n  Quick  fox ');
    expect(text).toBe('the quick fox');
    // Every normalized character points at where it came from.
    expect(map).toHaveLength(text.length);
    expect('  The\n  Quick  fox '[map[0] as number]).toBe('T');
    const foxAt = text.indexOf('fox');
    expect('  The\n  Quick  fox '[map[foxAt] as number]).toBe('f');
  });

  // THE INVARIANT THE WHOLE MODULE RESTS ON. `map[i]` is looked up by an index
  // into `text`, so there must be exactly one entry per CODE UNIT of `text`.
  // Anything that emits a different number of units than it consumed slides
  // every later offset by the difference, and offsets are what become live
  // Ranges: the find mark then lights up the wrong words for the rest of the
  // chapter.
  test('keeps one map entry per code unit when lowercasing changes length', () => {
    // Turkish capital I with dot lowercases to TWO code units (i + combining
    // dot above). One raw character in, two out.
    const raw = 'AİB needle here';
    const { text, map } = normalizeForSearch(raw);
    expect('İ'.toLowerCase()).toHaveLength(2); // the premise, pinned
    expect(map).toHaveLength(text.length);
    // Both emitted units point back at the single raw character they came from.
    const dotted = text.indexOf('i');
    expect(map[dotted]).toBe(1);
    expect(map[dotted + 1]).toBe(1);
  });

  test('an astral character keeps its two code units addressed separately', () => {
    const raw = 'a\u{1D4B3}b';
    const { text, map } = normalizeForSearch(raw);
    expect(map).toHaveLength(text.length);
    expect(map).toEqual([0, 1, 2, 3]);
  });
});

describe('createBookSearch', () => {
  const chapters = [
    'The quick brown fox jumps. A second quick moment.',
    'Nothing here but prose.',
    'quick, quick, quick',
  ];
  const search = createBookSearch(chapters.length, (i) => chapters[i] ?? '');

  test('finds every occurrence in every chapter, not just the first', () => {
    const { hits, capped } = search.search('quick');
    expect(capped).toBe(false);
    // Two in chapter 0, none in 1, three in 2.
    expect(hits.map((h) => h.chapter)).toEqual([0, 0, 2, 2, 2]);
  });

  test('is case-insensitive and reports usable snippets', () => {
    const { hits } = search.search('QUICK BROWN');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit) throw new Error('expected a hit');
    expect(hit.match).toBe('quick brown');
    expect(hit.after).toContain('fox');
    // Raw offsets address the real text, so the DOM layer can resolve them.
    expect(chapters[0]?.slice(hit.start, hit.end).toLowerCase()).toBe('quick brown');
  });

  test('a query shorter than the minimum matches nothing', () => {
    expect(search.search('q').hits).toHaveLength(0);
    expect(search.search('').hits).toHaveLength(0);
  });

  test('matches across a source newline, which the v1 finder missed', () => {
    const wrapped = createBookSearch(1, () => 'the quick\nbrown fox');
    const { hits } = wrapped.search('quick brown');
    expect(hits).toHaveLength(1);
  });

  test('caps the result list and says so', () => {
    const many = createBookSearch(1, () => 'ab '.repeat(SEARCH_HIT_CAP + 20));
    const { hits, capped } = many.search('ab');
    expect(hits).toHaveLength(SEARCH_HIT_CAP);
    expect(capped).toBe(true);
  });
});

/**
 * Text outside the Basic Multilingual Plane, which real books carry: maths
 * italics, older scripts, emoji in a modern preface. Two separate promises —
 * the OFFSETS a hit reports (they become a Range) and the SNIPPET a hit shows
 * (it goes on screen as-is).
 */
describe('astral characters and lowercase growth', () => {
  const ASTRAL = '\u{1D4B3}'; // MATHEMATICAL SCRIPT CAPITAL X, two code units
  /** A high or low surrogate standing on its own: a broken character. */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  test('a hit ending on an astral character reports both of its code units', () => {
    const raw = `the rune ${ASTRAL} marks it`;
    const { hits } = createBookSearch(1, () => raw).search(`rune ${ASTRAL}`);
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit) throw new Error('expected a hit');
    const matched = raw.slice(hit.start, hit.end);
    expect(matched).toBe(`rune ${ASTRAL}`);
    expect(LONE_SURROGATE.test(matched)).toBe(false);
  });

  test('a snippet never cuts an astral character in half', () => {
    // The context window is a fixed number of code units either side, so an
    // astral character sitting exactly on that boundary gets sliced through
    // the middle and the results list renders a replacement glyph.
    const trailing = `needle${'x'.repeat(SNIPPET_CONTEXT - 1)}${ASTRAL} tail`;
    const after = createBookSearch(1, () => trailing).search('needle').hits[0]?.after ?? '';
    expect(LONE_SURROGATE.test(after)).toBe(false);

    const leading = `start ${ASTRAL}${'y'.repeat(SNIPPET_CONTEXT - 1)}needle rest`;
    const before = createBookSearch(1, () => leading).search('needle').hits[0]?.before ?? '';
    expect(LONE_SURROGATE.test(before)).toBe(false);
  });

  test('a character that grows when lowercased does not slide later hits', () => {
    // Everything after the grown character is what breaks: the hit is found in
    // normalized space, then read back through the map into raw space.
    const raw = 'AİB needle here';
    const { hits } = createBookSearch(1, () => raw).search('needle');
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    if (!hit) throw new Error('expected a hit');
    expect(raw.slice(hit.start, hit.end)).toBe('needle');
  });
});

describe('find marks in the DOM', () => {
  test('marks a phrase that spans inline tags (the v1 debt)', () => {
    const wrapper = wrapperWith('<p>the <em>quick</em> brown fox</p>');
    const search = createBookSearch(1, () => rawTextOf(wrapper));
    const { hits } = search.search('the quick brown');
    expect(hits).toHaveLength(1);

    expect(applyFindMarks(wrapper, hits, 0)).toBe(1);
    const marks = findMarks(wrapper, 0);
    // One mark per intersecting text node: "the ", "quick", " brown".
    expect(marks.length).toBeGreaterThan(1);
    expect(marks.map((m) => m.textContent).join('')).toBe('the quick brown');
    // The <em> survives: marks wrap text, never restructure the tree.
    expect(wrapper.querySelector('em')?.textContent).toBe('quick');
  });

  test('marks every occurrence, each addressable on its own', () => {
    const wrapper = wrapperWith('<p>quick and quick again</p>');
    const search = createBookSearch(1, () => rawTextOf(wrapper));
    const { hits } = search.search('quick');
    expect(applyFindMarks(wrapper, hits, 0)).toBe(2);
    expect(findMarks(wrapper, 0)).toHaveLength(1);
    expect(findMarks(wrapper, 1)).toHaveLength(1);
  });

  test('clearing restores the original tree so locators stay stable', () => {
    const wrapper = wrapperWith('<p>the <em>quick</em> brown fox</p>');
    const before = wrapper.innerHTML;
    const search = createBookSearch(1, () => rawTextOf(wrapper));
    applyFindMarks(wrapper, search.search('quick brown').hits, 0);
    expect(wrapper.querySelectorAll('mark.find-hit').length).toBeGreaterThan(0);

    clearFindMarks(wrapper);
    expect(wrapper.querySelectorAll('mark.find-hit')).toHaveLength(0);
    expect(wrapper.innerHTML).toBe(before);
    // normalize() re-fused the split text nodes.
    expect(wrapper.querySelector('p')?.childNodes).toHaveLength(3);
  });

  test('a stale hit is skipped, never a crash', () => {
    const wrapper = wrapperWith('<p>short</p>');
    const marked = applyFindMarks(
      wrapper,
      [{ chapter: 0, start: 9000, end: 9005, before: '', match: 'x', after: '' }],
      0,
    );
    expect(marked).toBe(0);
  });
});

describe('per-chapter offsets stay inside their chapter', () => {
  test('a hit from another chapter never marks this one', () => {
    // Same offsets, different chapter: without the chapter filter this would
    // resolve against the rendered text and light up the wrong words.
    const wrapper = wrapperWith('<p>the quick brown fox jumps over it all</p>');
    const foreign = [{ chapter: 7, start: 4, end: 9, before: '', match: 'quick', after: '' }];
    expect(applyFindMarks(wrapper, foreign, 0)).toBe(0);
    expect(wrapper.querySelectorAll('mark.find-hit')).toHaveLength(0);
  });

  test('mark indices are the result-list indices, across chapters', () => {
    const wrapper = wrapperWith('<p>quick</p>');
    const hits = [
      { chapter: 0, start: 0, end: 5, before: '', match: 'quick', after: '' },
      { chapter: 1, start: 0, end: 5, before: '', match: 'quick', after: '' },
      { chapter: 1, start: 6, end: 11, before: '', match: 'quick', after: '' },
    ];
    expect(applyFindMarks(wrapper, hits, 0)).toBe(1);
    // Hit 0 is chapter 0's: it keeps index 0 even though later hits exist.
    expect(findMarks(wrapper, 0)).toHaveLength(1);
    expect(findMarks(wrapper, 1)).toHaveLength(0);
  });
});
