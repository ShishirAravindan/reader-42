// Typography prefs resolved into what the renderer consumes (parity C1–C6).
// Device-local taste (kickoff resolution C8): read from prefs at call time,
// so the ReaderView accessors always see the current values.

import { DEFAULT_TYPOGRAPHY, type ReaderTypography } from '../reader/render.ts';
import {
  FONT_SIZE_STEPS_REM,
  type FontFamily,
  getAlign,
  getBoldness,
  getFontFamily,
  getFontSizeIndex,
  getLeading,
} from './prefs.ts';

/**
 * The curated faces (C1) as full family stacks; null means the publisher
 * default — no override rule is generated at all. The fallbacks match each
 * face's character so an unloaded font degrades to the same texture.
 */
export const FONT_STACKS: Record<FontFamily, string | null> = {
  publisher: null,
  literata: "'Literata', 'Iowan Old Style', Georgia, serif",
  atkinson: "'Atkinson Hyperlegible', 'Trebuchet MS', Verdana, sans-serif",
  opendyslexic: "'OpenDyslexic', Verdana, sans-serif",
};

export function resolvedFontStack(family: FontFamily): string | null {
  return FONT_STACKS[family];
}

/** The current typography prefs in the renderer's terms. */
export function currentTypography(): ReaderTypography {
  return {
    fontStack: resolvedFontStack(getFontFamily()),
    fontSizeRem: FONT_SIZE_STEPS_REM[getFontSizeIndex()] ?? DEFAULT_TYPOGRAPHY.fontSizeRem,
    leading: getLeading(),
    weight: getBoldness(),
    align: getAlign(),
  };
}
