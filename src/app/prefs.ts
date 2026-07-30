// Device-local taste (kickoff resolution C8): display and typography prefs
// live on this device only; place (position, bookmarks, highlights) syncs
// through the library. localStorage-backed and schema-tolerant: data written
// by any other version degrades to defaults, never to a crash.

import type { DisplayMode } from '../reader/mode.ts';
import type { PaceState } from '../reader/pace.ts';
import type { TextAlign } from '../reader/render.ts';
import { STATUS_MODES, type StatusMode } from './status.ts';

const KEY = 'reader42-prefs';
const PACE_KEY_PREFIX = 'reader42-pace-';

export function getDisplayMode(): DisplayMode {
  return readPrefs().displayMode === 'scroll' ? 'scroll' : 'paged';
}

export function setDisplayMode(mode: DisplayMode): void {
  writePrefs({ ...readPrefs(), displayMode: mode });
}

// --- typography (parity C1–C6): discrete steps, always valid members ---

export const FONT_FAMILIES = ['publisher', 'literata', 'atkinson', 'opendyslexic'] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

/** Discrete size steps (C2); an index keeps the pref stable if values shift. */
export const FONT_SIZE_STEPS_REM = [0.85, 0.95, 1.05, 1.15, 1.28, 1.42, 1.58, 1.75] as const;
export const DEFAULT_FONT_SIZE_INDEX = 2;

/** Bold steps (C3). Literata is variable, so the middle weights are real. */
export const BOLDNESS_STEPS = [400, 450, 500, 575] as const;
export type Boldness = (typeof BOLDNESS_STEPS)[number];

export const LEADING_STEPS = [1.45, 1.65, 1.9] as const;
export type Leading = (typeof LEADING_STEPS)[number];

/**
 * Measure presets in CHARACTERS (C5): capping the line in characters rather
 * than pixels keeps the same number of words on a line at every size step,
 * instead of the measure starving as the type grows. Margins are the inverse —
 * a bigger measure means narrower margins.
 */
export const MEASURE_STEPS_CH = [60, 66, 74] as const;
export type MeasureCh = (typeof MEASURE_STEPS_CH)[number];

/**
 * The measure used to be capped in rem. A stored rem preset keeps the reader's
 * STEP (wide stays wide), which is what they actually chose; the pixel width it
 * used to mean is not worth preserving.
 */
const LEGACY_MEASURE_REM: Record<number, MeasureCh> = { 34: 60, 38: 66, 44: 74 };

export function getFontFamily(): FontFamily {
  const raw = readPrefs().fontFamily;
  return FONT_FAMILIES.includes(raw as FontFamily) ? (raw as FontFamily) : 'literata';
}

export function setFontFamily(family: FontFamily): void {
  writePrefs({ ...readPrefs(), fontFamily: family });
}

export function getFontSizeIndex(): number {
  const raw = readPrefs().fontSize;
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return DEFAULT_FONT_SIZE_INDEX;
  return Math.min(Math.max(raw, 0), FONT_SIZE_STEPS_REM.length - 1);
}

export function setFontSizeIndex(index: number): void {
  writePrefs({ ...readPrefs(), fontSize: index });
}

export function getBoldness(): Boldness {
  const raw = readPrefs().boldness;
  return BOLDNESS_STEPS.includes(raw as Boldness) ? (raw as Boldness) : 400;
}

export function setBoldness(boldness: Boldness): void {
  writePrefs({ ...readPrefs(), boldness });
}

export function getLeading(): Leading {
  const raw = readPrefs().leading;
  return LEADING_STEPS.includes(raw as Leading) ? (raw as Leading) : 1.65;
}

export function setLeading(leading: Leading): void {
  writePrefs({ ...readPrefs(), leading });
}

export function getMeasureCh(): MeasureCh {
  const prefs = readPrefs();
  const raw = prefs.measureCh;
  if (MEASURE_STEPS_CH.includes(raw as MeasureCh)) return raw as MeasureCh;
  const legacy = prefs.measureRem;
  return (typeof legacy === 'number' ? LEGACY_MEASURE_REM[legacy] : undefined) ?? 66;
}

export function setMeasureCh(measureCh: MeasureCh): void {
  writePrefs({ ...readPrefs(), measureCh });
}

export function getAlign(): TextAlign {
  return readPrefs().align === 'justify' ? 'justify' : 'left';
}

export function setAlign(align: TextAlign): void {
  writePrefs({ ...readPrefs(), align });
}

// --- page-color theme (parity D1) ---

export const THEMES = ['paper', 'white', 'sepia', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function getTheme(): Theme {
  const raw = readPrefs().theme;
  return THEMES.includes(raw as Theme) ? (raw as Theme) : 'paper';
}

export function setTheme(theme: Theme): void {
  writePrefs({ ...readPrefs(), theme });
}

export function getStatusMode(): StatusMode {
  const raw = readPrefs().statusMode;
  return STATUS_MODES.includes(raw as StatusMode) ? (raw as StatusMode) : 'time-left-chapter';
}

export function setStatusMode(mode: StatusMode): void {
  writePrefs({ ...readPrefs(), statusMode: mode });
}

// --- reading pace, per book (parity B5) ---
// Device-local by design (kickoff resolution 3): pace is taste-like telemetry
// about this reader on this device, not place, so it never syncs.

export function getPace(bookId: string): PaceState | null {
  try {
    const raw = localStorage.getItem(PACE_KEY_PREFIX + bookId);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const { charsPerSec, sampledSec } = parsed as Record<string, unknown>;
      if (
        typeof charsPerSec === 'number' &&
        Number.isFinite(charsPerSec) &&
        charsPerSec >= 0 &&
        typeof sampledSec === 'number' &&
        Number.isFinite(sampledSec) &&
        sampledSec >= 0
      ) {
        return { charsPerSec, sampledSec };
      }
    }
  } catch {
    // Unreadable storage or malformed JSON: the model just starts learning.
  }
  return null;
}

export function setPace(bookId: string, state: PaceState): void {
  try {
    localStorage.setItem(PACE_KEY_PREFIX + bookId, JSON.stringify(state));
  } catch {
    // Storage full or blocked: pace re-learns next time.
  }
}

function readPrefs(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Unreadable storage or malformed JSON: fall through to defaults.
  }
  return {};
}

function writePrefs(prefs: Record<string, unknown>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: the preference just doesn't stick.
  }
}
