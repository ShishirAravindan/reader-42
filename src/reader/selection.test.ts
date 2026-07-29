import { describe, expect, test } from 'bun:test';
import { readerSelection, singleWord, wordFromSelection } from './selection.ts';

function shadowWithText(text: string): { shadow: ShadowRoot; textNode: Text } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const p = document.createElement('p');
  p.textContent = text;
  shadow.appendChild(p);
  return { shadow, textNode: p.firstChild as Text };
}

function fakeSelection(range: Range | null): Selection {
  return {
    rangeCount: range ? 1 : 0,
    isCollapsed: range ? range.collapsed : true,
    getRangeAt: () => {
      if (!range) throw new Error('no range');
      return range;
    },
  } as unknown as Selection;
}

describe('readerSelection', () => {
  test('prefers shadowRoot.getSelection (the Chromium path)', () => {
    const { shadow, textNode } = shadowWithText('shadow words');
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    (shadow as ShadowRoot & { getSelection(): Selection }).getSelection = () =>
      fakeSelection(range);
    expect(readerSelection(shadow)?.toString()).toBe('shadow');
  });

  test('rejects a selection living outside the shadow tree (containment check)', () => {
    const { shadow } = shadowWithText('inside');
    const outside = document.createElement('p');
    outside.textContent = 'outside text';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    (shadow as ShadowRoot & { getSelection(): Selection }).getSelection = () =>
      fakeSelection(range);
    expect(readerSelection(shadow)).toBeNull();
    outside.remove();
  });

  test('collapsed or absent selections are null', () => {
    const { shadow, textNode } = shadowWithText('words');
    const collapsed = document.createRange();
    collapsed.setStart(textNode, 2);
    collapsed.collapse(true);
    (shadow as ShadowRoot & { getSelection(): Selection | null }).getSelection = () =>
      fakeSelection(collapsed);
    expect(readerSelection(shadow)).toBeNull();
  });
});

describe('wordFromSelection / singleWord', () => {
  test('trims whitespace and surrounding punctuation', () => {
    const { textNode } = shadowWithText('… "deliberately," she said');
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 16); // '… "deliberately,'
    expect(wordFromSelection(range)).toBe('deliberately');
  });

  test('keeps internal apostrophes and hyphens', () => {
    expect(singleWord("  don't ")).toBe("don't");
    expect(singleWord('(well-worn)')).toBe('well-worn');
  });

  test('multi-word, empty, and oversized selections are null', () => {
    expect(singleWord('two words')).toBeNull();
    expect(singleWord('  …!  ')).toBeNull();
    expect(singleWord('x'.repeat(49))).toBeNull();
    expect(singleWord('x'.repeat(48))).toBe('x'.repeat(48));
  });
});
