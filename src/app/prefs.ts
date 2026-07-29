// Device-local taste (kickoff resolution C8): display and typography prefs
// live on this device only; place (position, bookmarks, highlights) syncs
// through the library. localStorage-backed and schema-tolerant: data written
// by any other version degrades to defaults, never to a crash.

import type { DisplayMode } from '../reader/mode.ts';
import type { PaceState } from '../reader/pace.ts';

const KEY = 'reader42-prefs';
const PACE_KEY_PREFIX = 'reader42-pace-';

export function getDisplayMode(): DisplayMode {
  return readPrefs().displayMode === 'scroll' ? 'scroll' : 'paged';
}

export function setDisplayMode(mode: DisplayMode): void {
  writePrefs({ ...readPrefs(), displayMode: mode });
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
