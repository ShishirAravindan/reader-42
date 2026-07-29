import { beforeEach, describe, expect, test } from 'bun:test';
import { getDisplayMode, setDisplayMode } from './prefs.ts';

const KEY = 'reader42-prefs';

describe('display mode pref', () => {
  beforeEach(() => localStorage.clear());

  test('defaults to paged (kindle parity A1)', () => {
    expect(getDisplayMode()).toBe('paged');
  });

  test('round-trips scroll', () => {
    setDisplayMode('scroll');
    expect(getDisplayMode()).toBe('scroll');
    setDisplayMode('paged');
    expect(getDisplayMode()).toBe('paged');
  });

  test('bad persisted data degrades to the default, never throws', () => {
    for (const bad of ['{oops', '[1,2]', '"scroll"', JSON.stringify({ displayMode: 'diag' })]) {
      localStorage.setItem(KEY, bad);
      expect(getDisplayMode()).toBe('paged');
    }
  });

  test('writes preserve unknown keys from other versions', () => {
    localStorage.setItem(KEY, JSON.stringify({ future: true, displayMode: 'scroll' }));
    setDisplayMode('paged');
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(stored).toEqual({ future: true, displayMode: 'paged' });
  });
});
