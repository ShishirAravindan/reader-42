import { describe, expect, test } from 'bun:test';
import { clampRatio, elementAtPath } from './locator.ts';

function wrapper(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<div class="chapter">${html}</div>`, 'text/html');
  return doc.querySelector('.chapter') as HTMLElement;
}

describe('elementAtPath', () => {
  test('resolves a structural path, skipping overlay marks', () => {
    // A highlight <mark> is presentation, not structure: it must not shift the
    // index of the paragraphs around it.
    const root = wrapper('<p id="a">a</p><mark class="hl">m</mark><p id="b">b</p>');
    expect(elementAtPath(root, [0])?.id).toBe('a');
    expect(elementAtPath(root, [1])?.id).toBe('b');
  });

  test('foreign or corrupt paths degrade to null, never resolve to garbage', () => {
    const root = wrapper('<p>a</p><p>b</p>');
    expect(elementAtPath(root, [9])).toBeNull(); // out of range
    expect(elementAtPath(root, [-1])).toBeNull(); // negative
    expect(elementAtPath(root, [1.5])).toBeNull(); // non-integer
    expect(elementAtPath(root, [Number.NaN])).toBeNull();
    expect(elementAtPath(root, ['0' as unknown as number])).toBeNull(); // wrong type
  });
});

describe('clampRatio', () => {
  test('clamps into range and rescues non-finite values', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(-0.2)).toBe(0);
    expect(clampRatio(1.4)).toBe(1);
    expect(clampRatio(Number.NaN)).toBe(0);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
