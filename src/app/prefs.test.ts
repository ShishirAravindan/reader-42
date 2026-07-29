import { beforeEach, describe, expect, test } from 'bun:test';
import { getDisplayMode, getPace, setDisplayMode, setPace } from './prefs.ts';

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

describe('pace storage (per book, device-local)', () => {
  beforeEach(() => localStorage.clear());

  test('missing pace is null', () => {
    expect(getPace('abc123')).toBeNull();
  });

  test('round-trips per book, keyed separately', () => {
    setPace('book-a', { charsPerSec: 18.5, sampledSec: 240 });
    setPace('book-b', { charsPerSec: 9, sampledSec: 60 });
    expect(getPace('book-a')).toEqual({ charsPerSec: 18.5, sampledSec: 240 });
    expect(getPace('book-b')).toEqual({ charsPerSec: 9, sampledSec: 60 });
  });

  test('bad persisted pace degrades to null, never throws', () => {
    for (const bad of [
      '{oops',
      '[1,2]',
      '"fast"',
      JSON.stringify({ charsPerSec: 'x', sampledSec: 1 }),
      JSON.stringify({ charsPerSec: -2, sampledSec: 1 }),
      JSON.stringify({ charsPerSec: 5 }),
    ]) {
      localStorage.setItem('reader42-pace-x', bad);
      expect(getPace('x')).toBeNull();
    }
  });
});
