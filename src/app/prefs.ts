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

/** Measure presets (C5); margins are the inverse — bigger measure, less margin. */
export const MEASURE_STEPS_REM = [34, 38, 44] as const;
export type MeasureRem = (typeof MEASURE_STEPS_REM)[number];

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

export function getMeasureRem(): MeasureRem {
  const raw = readPrefs().measureRem;
  return MEASURE_STEPS_REM.includes(raw as MeasureRem) ? (raw as MeasureRem) : 38;
}

export function setMeasureRem(measureRem: MeasureRem): void {
  writePrefs({ ...readPrefs(), measureRem });
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
