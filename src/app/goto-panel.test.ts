import { describe, expect, test } from 'bun:test';
import type { PageAnchor } from '../reader/metrics.ts';
import { resolveGoTo } from './goto-panel.ts';

const pages: PageAnchor[] = [
  { label: '1', globalChar: 0 },
  { label: 'xii', globalChar: 400 },
  { label: '2', globalChar: 900 },
];

describe('resolveGoTo', () => {
  test('a print page label wins over the location reading of the same digits', () => {
    expect(resolveGoTo('2', pages, 500)).toEqual({ kind: 'page', label: '2', globalChar: 900 });
  });

  test('roman-numeral and other non-numeric page labels resolve too', () => {
    expect(resolveGoTo(' XII ', pages, 500)).toEqual({
      kind: 'page',
      label: 'xii',
      globalChar: 400,
    });
  });

  test('a book without print pages reads the entry as a location', () => {
    expect(resolveGoTo('42', [], 500)).toEqual({ kind: 'location', location: 42 });
    expect(resolveGoTo('  7  ', [], 500)).toEqual({ kind: 'location', location: 7 });
  });

  test('a number past the last location names nothing', () => {
    expect(resolveGoTo('501', [], 500)).toBeNull();
    expect(resolveGoTo('0', [], 500)).toBeNull();
  });

  test('empty and non-numeric entries name nothing', () => {
    expect(resolveGoTo('', pages, 500)).toBeNull();
    expect(resolveGoTo('   ', pages, 500)).toBeNull();
    expect(resolveGoTo('chapter three', pages, 500)).toBeNull();
    expect(resolveGoTo('12.5', [], 500)).toBeNull();
  });

  test('the first and last locations are inside the range', () => {
    expect(resolveGoTo('1', [], 500)).toEqual({ kind: 'location', location: 1 });
    expect(resolveGoTo('500', [], 500)).toEqual({ kind: 'location', location: 500 });
  });
});
