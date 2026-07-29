import { describe, expect, test } from 'bun:test';
import type { Highlight } from '../library/types.ts';
import {
  applyHighlight,
  highlightMarks,
  removeHighlight,
  resolveBoundaries,
  serializeRange,
} from './annotate.ts';

/** A chapter wrapper living in the shared jsdom document (Range needs it). */
function wrapper(html: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'chapter';
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Range over [from, to) of an element's FLATTENED text, built by hand. */
function rangeOver(el: Element, from: number, to: number): Range {
  const range = document.createRange();
  let acc = 0;
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      const len = (node as Text).data.length;
      if (from >= acc && from <= acc + len) range.setStart(node, from - acc);
      if (to >= acc && to <= acc + len) range.setEnd(node, to - acc);
      acc += len;
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(el);
  return range;
}

const hl = (id: string, over: Partial<Highlight> = {}): { id: string; color: 'yellow' } & object =>
  ({ id, color: 'yellow' as const, ...over }) as never;

describe('serializeRange', () => {
  test('a plain in-paragraph range serializes path + flattened offsets', () => {
    const root = wrapper('<p>Hello brave new world</p>');
    const p = root.querySelector('p') as Element;
    const s = serializeRange(root, rangeOver(p, 6, 15));
    expect(s).toEqual({
      start: { path: [0], offset: 6 },
      end: { path: [0], offset: 15 },
      text: 'brave new',
    });
  });

  test('a range crossing an <em> keeps element-precise boundaries', () => {
    const root = wrapper('<p>one <em>two</em> three</p>');
    const p = root.querySelector('p') as Element;
    const em = root.querySelector('em') as Element;
    // Start inside "one " (a direct text child of p), end inside the em.
    const range = document.createRange();
    range.setStart(p.firstChild as Node, 2);
    range.setEnd(em.firstChild as Node, 2);
    const s = serializeRange(root, range);
    expect(s?.start).toEqual({ path: [0], offset: 2 });
    expect(s?.end).toEqual({ path: [0, 0], offset: 2 });
    expect(s?.text).toBe('e tw');
  });

  test('collapsed and degenerate ranges are null', () => {
    const root = wrapper('<p>some text</p>');
    const p = root.querySelector('p') as Element;
    const collapsed = document.createRange();
    collapsed.setStart(p.firstChild as Node, 3);
    collapsed.collapse(true);
    expect(serializeRange(root, collapsed)).toBeNull();
  });

  test('a range outside the wrapper is null', () => {
    const root = wrapper('<p>inside</p>');
    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(serializeRange(root, range)).toBeNull();
    outside.remove();
  });

  test('whitespace-collapses the stored text', () => {
    const root = wrapper('<p>spaced   out\n  text</p>');
    const p = root.querySelector('p') as Element;
    const s = serializeRange(root, rangeOver(p, 0, (p.textContent ?? '').length));
    expect(s?.text).toBe('spaced out text');
  });
});

describe('marks are invisible to serialization (salvage §1)', () => {
  test('the second highlight in an already-marked paragraph serializes against clean structure, and both restore from scratch', () => {
    const root = wrapper('<p>Hello brave new world of marks</p>');
    const p = root.querySelector('p') as Element;
    const pristine = root.innerHTML;

    // First highlight over "brave".
    const first = serializeRange(root, rangeOver(p, 6, 11));
    expect(first).not.toBeNull();
    if (!first) throw new Error('unreachable');
    const r1 = resolveBoundaries(root, first.start, first.end);
    expect(r1).not.toBeNull();
    applyHighlight(root, hl('aaaa0001'), r1 as Range);
    expect(highlightMarks(root, 'aaaa0001')).toHaveLength(1);

    // Second highlight over "world", built against the NOW-MARKED DOM: the
    // paragraph's text nodes are split by the first mark, but the serialized
    // offsets must describe the mark-free flattened text.
    const second = serializeRange(root, rangeOver(p, 16, 21));
    expect(second).toEqual({
      start: { path: [0], offset: 16 },
      end: { path: [0], offset: 21 },
      text: 'world',
    });
    if (!second) throw new Error('unreachable');

    // A range STARTING INSIDE the first mark also climbs out to the paragraph.
    const markText = highlightMarks(root, 'aaaa0001')[0]?.firstChild as Node;
    const insideMark = document.createRange();
    insideMark.setStart(markText, 1); // "r" in brave -> flattened offset 7
    insideMark.setEnd(markText, 4);
    expect(serializeRange(root, insideMark)?.start).toEqual({ path: [0], offset: 7 });

    // Wipe all marks and re-apply BOTH from their persisted boundaries.
    removeHighlight(root, 'aaaa0001');
    expect(root.innerHTML).toBe(pristine);
    for (const [id, s] of [
      ['aaaa0001', first],
      ['bbbb0002', second],
    ] as const) {
      const range = resolveBoundaries(root, s.start, s.end);
      expect(range).not.toBeNull();
      applyHighlight(root, hl(id), range as Range);
    }
    expect(highlightMarks(root, 'aaaa0001')[0]?.textContent).toBe('brave');
    expect(highlightMarks(root, 'bbbb0002')[0]?.textContent).toBe('world');
    expect(p.textContent).toBe('Hello brave new world of marks');
  });

  test('resolveBoundaries reads offsets through marks already in the tree', () => {
    const root = wrapper('<p>alpha beta gamma</p>');
    const p = root.querySelector('p') as Element;
    applyHighlight(root, hl('cccc0003'), rangeOver(p, 0, 5)); // marks "alpha"
    // "gamma" against the original flattened text: offsets 11..16.
    const range = resolveBoundaries(root, { path: [0], offset: 11 }, { path: [0], offset: 16 });
    expect(range?.toString()).toBe('gamma');
  });
});

describe('applyHighlight', () => {
  test('a cross-element range wraps each text segment in its own mark', () => {
    const root = wrapper('<p>one <em>two</em> three</p>');
    const p = root.querySelector('p') as Element;
    applyHighlight(root, hl('dddd0004'), rangeOver(p, 2, 9)); // "e two t"
    const marks = highlightMarks(root, 'dddd0004');
    expect(marks).toHaveLength(3);
    expect(marks.map((m) => m.textContent)).toEqual(['e ', 'two', ' t']);
    // Marks contain only text: the locator invariant.
    for (const m of marks) {
      expect(m.children).toHaveLength(0);
      expect(m.className).toBe('hl hl-yellow');
      expect(m.dataset.hl).toBe('dddd0004');
    }
    expect(p.textContent).toBe('one two three');
  });

  test('whitespace-only block gaps are not wrapped', () => {
    const root = wrapper('<p>alpha</p>\n  <p>beta</p>');
    const range = document.createRange();
    range.setStart(root.querySelectorAll('p')[0]?.firstChild as Node, 2);
    range.setEnd(root.querySelectorAll('p')[1]?.firstChild as Node, 2);
    applyHighlight(root, hl('eeee0005'), range);
    const marks = highlightMarks(root, 'eeee0005');
    expect(marks.map((m) => m.textContent)).toEqual(['pha', 'be']);
  });

  test('a note adds the marker class to the final segment only', () => {
    const root = wrapper('<p>one <em>two</em> three</p>');
    const p = root.querySelector('p') as Element;
    applyHighlight(root, { id: 'ffff0006', color: 'pink', note: 'nb' }, rangeOver(p, 0, 13));
    const marks = highlightMarks(root, 'ffff0006');
    expect(marks).toHaveLength(3);
    expect(marks.slice(0, -1).every((m) => !m.classList.contains('has-note'))).toBe(true);
    expect(marks[marks.length - 1]?.classList.contains('has-note')).toBe(true);
    expect(marks[0]?.classList.contains('hl-pink')).toBe(true);
  });
});

describe('removeHighlight', () => {
  test('remove + normalize leaves the DOM byte-identical to pre-highlight', () => {
    const root = wrapper('<p>Hello brave new world</p><p>and <em>another</em> block</p>');
    const before = root.innerHTML;
    const p1 = root.querySelectorAll('p')[0] as Element;
    const p2 = root.querySelectorAll('p')[1] as Element;
    applyHighlight(root, hl('abcd0007'), rangeOver(p1, 6, 15));
    applyHighlight(root, { id: 'abcd0008', color: 'blue' }, rangeOver(p2, 2, 9));
    expect(root.innerHTML).not.toBe(before);
    removeHighlight(root, 'abcd0007');
    removeHighlight(root, 'abcd0008');
    expect(root.innerHTML).toBe(before);
    // Text nodes re-fused, not merely adjacent.
    expect(p1.childNodes).toHaveLength(1);
  });
});

describe('stale boundaries', () => {
  test('missing element and past-the-end offsets resolve to null, never throw', () => {
    const root = wrapper('<p>short</p>');
    // Path into a vanished element.
    expect(resolveBoundaries(root, { path: [4], offset: 0 }, { path: [4], offset: 3 })).toBeNull();
    // Offset beyond the element's text.
    expect(resolveBoundaries(root, { path: [0], offset: 2 }, { path: [0], offset: 99 })).toBeNull();
    // Start at/after end: collapsed.
    expect(resolveBoundaries(root, { path: [0], offset: 3 }, { path: [0], offset: 3 })).toBeNull();
  });
});
