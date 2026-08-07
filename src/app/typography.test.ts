import { beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_TYPOGRAPHY } from '../reader/render.ts';
import { setAlign, setBoldness, setFontFamily, setFontSizeIndex, setLeading } from './prefs.ts';
import { currentTypography, resolvedFontStack } from './typography.ts';

const KEY = 'reader42-prefs';

describe('resolvedFontStack', () => {
  test('publisher default resolves to null: no override rule at all', () => {
    expect(resolvedFontStack('publisher')).toBeNull();
  });

  test('curated faces resolve to stacks led by the bundled family', () => {
    expect(resolvedFontStack('literata')).toStartWith("'Literata'");
    expect(resolvedFontStack('atkinson')).toStartWith("'Atkinson Hyperlegible'");
    expect(resolvedFontStack('opendyslexic')).toStartWith("'OpenDyslexic'");
  });
});

describe('currentTypography', () => {
  beforeEach(() => localStorage.clear());

  test('defaults: literata at step 2, regular, normal leading, left-aligned', () => {
    expect(currentTypography()).toEqual({
      fontStack: resolvedFontStack('literata'),
      fontSizeRem: 1.05,
      leading: 1.65,
      weight: 400,
      align: 'left',
    });
  });

  test('reflects each pref live', () => {
    setFontFamily('atkinson');
    setFontSizeIndex(4);
    setBoldness(500);
    setLeading(1.9);
    setAlign('justify');
    expect(currentTypography()).toEqual({
      fontStack: resolvedFontStack('atkinson'),
      fontSizeRem: 1.28,
      leading: 1.9,
      weight: 500,
      align: 'justify',
    });
  });

  test('publisher family yields a null stack', () => {
    setFontFamily('publisher');
    expect(currentTypography().fontStack).toBeNull();
  });

  test('garbage prefs degrade to the stock look, matching the CSS fallbacks', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ fontFamily: 'wingdings', fontSize: 99.5, boldness: 9000, leading: 0 }),
    );
    const typo = currentTypography();
    expect(typo.fontSizeRem).toBe(DEFAULT_TYPOGRAPHY.fontSizeRem);
    expect(typo.leading).toBe(DEFAULT_TYPOGRAPHY.leading);
    expect(typo.weight).toBe(DEFAULT_TYPOGRAPHY.weight);
    expect(typo.align).toBe(DEFAULT_TYPOGRAPHY.align);
    expect(typo.fontStack).toBe(resolvedFontStack('literata')); // family default
  });
});
