import { beforeEach, describe, expect, test } from 'bun:test';
import {
  getAlign,
  getBoldness,
  getDisplayMode,
  getFontFamily,
  getFontSizeIndex,
  getLeading,
  getMeasureChars,
  getPace,
  getStatusMode,
  getTheme,
  setAlign,
  setBoldness,
  setDisplayMode,
  setFontFamily,
  setFontSizeIndex,
  setLeading,
  setMeasureChars,
  setPace,
  setStatusMode,
  setTheme,
} from './prefs.ts';

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

describe('status mode pref', () => {
  beforeEach(() => localStorage.clear());

  test('defaults to time-left-chapter and round-trips', () => {
    expect(getStatusMode()).toBe('time-left-chapter');
    setStatusMode('location');
    expect(getStatusMode()).toBe('location');
    setStatusMode('off');
    expect(getStatusMode()).toBe('off');
  });

  test('bad persisted status mode degrades to the default', () => {
    localStorage.setItem(KEY, JSON.stringify({ statusMode: 'sideways' }));
    expect(getStatusMode()).toBe('time-left-chapter');
  });
});

describe('typography prefs (parity C1-C6, device-local taste)', () => {
  beforeEach(() => localStorage.clear());

  test('defaults: literata, size index 2, 400, 1.65, 66ch, left', () => {
    expect(getFontFamily()).toBe('literata');
    expect(getFontSizeIndex()).toBe(2);
    expect(getBoldness()).toBe(400);
    expect(getLeading()).toBe(1.65);
    expect(getMeasureChars()).toBe(66);
    expect(getAlign()).toBe('left');
  });

  test('round-trips every field', () => {
    setFontFamily('opendyslexic');
    setFontSizeIndex(7);
    setBoldness(575);
    setLeading(1.45);
    setMeasureChars(74);
    setAlign('justify');
    expect(getFontFamily()).toBe('opendyslexic');
    expect(getFontSizeIndex()).toBe(7);
    expect(getBoldness()).toBe(575);
    expect(getLeading()).toBe(1.45);
    expect(getMeasureChars()).toBe(74);
    expect(getAlign()).toBe('justify');
  });

  test('size index clamps into the step range, non-integers degrade', () => {
    localStorage.setItem(KEY, JSON.stringify({ fontSize: 99 }));
    expect(getFontSizeIndex()).toBe(7);
    localStorage.setItem(KEY, JSON.stringify({ fontSize: -3 }));
    expect(getFontSizeIndex()).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ fontSize: 1.5 }));
    expect(getFontSizeIndex()).toBe(2);
  });

  test('non-member persisted values degrade to defaults, never throw', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        fontFamily: 'papyrus',
        boldness: 401,
        leading: 2.4,
        measureChars: 10,
        align: 'center',
      }),
    );
    expect(getFontFamily()).toBe('literata');
    expect(getBoldness()).toBe(400);
    expect(getLeading()).toBe(1.65);
    expect(getMeasureChars()).toBe(66);
    expect(getAlign()).toBe('left');
  });

  test('a measure stored as rem keeps the reader’s margin step', () => {
    for (const [rem, ch] of [
      [34, 60],
      [38, 66],
      [44, 74],
    ] as const) {
      localStorage.setItem(KEY, JSON.stringify({ measureRem: rem }));
      expect(getMeasureChars()).toBe(ch);
    }
    // A character measure of its own always wins over the legacy key.
    localStorage.setItem(KEY, JSON.stringify({ measureRem: 34, measureChars: 74 }));
    expect(getMeasureChars()).toBe(74);
  });
});

describe('theme pref (parity D1)', () => {
  beforeEach(() => localStorage.clear());

  test('defaults to paper and round-trips every theme', () => {
    expect(getTheme()).toBe('paper');
    for (const theme of ['white', 'sepia', 'dark', 'paper'] as const) {
      setTheme(theme);
      expect(getTheme()).toBe(theme);
    }
  });

  test('bad persisted theme degrades to paper', () => {
    for (const bad of ['{oops', JSON.stringify({ theme: 'green' }), JSON.stringify({ theme: 7 })]) {
      localStorage.setItem(KEY, bad);
      expect(getTheme()).toBe('paper');
    }
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
