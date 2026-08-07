import { describe, expect, test } from 'bun:test';
import { canStepFontSize, stepFontSize } from './aa-panel.ts';
import { FONT_SIZE_STEPS_REM } from './prefs.ts';

const LAST = FONT_SIZE_STEPS_REM.length - 1;

describe('font size stepping', () => {
  test('steps by one and clamps at both ends', () => {
    expect(stepFontSize(2, 1)).toBe(3);
    expect(stepFontSize(2, -1)).toBe(1);
    expect(stepFontSize(0, -1)).toBe(0);
    expect(stepFontSize(LAST, 1)).toBe(LAST);
  });

  test('out-of-range indices come back into the range', () => {
    expect(stepFontSize(99, 1)).toBe(LAST);
    expect(stepFontSize(-7, -1)).toBe(0);
  });

  test('canStep disables exactly at the ends', () => {
    expect(canStepFontSize(0, -1)).toBe(false);
    expect(canStepFontSize(0, 1)).toBe(true);
    expect(canStepFontSize(LAST, 1)).toBe(false);
    expect(canStepFontSize(LAST, -1)).toBe(true);
    expect(canStepFontSize(3, 1)).toBe(true);
    expect(canStepFontSize(3, -1)).toBe(true);
  });
});
