// Device-local taste (kickoff resolution C8): display and typography prefs
// live on this device only; place (position, bookmarks, highlights) syncs
// through the library. localStorage-backed and schema-tolerant: data written
// by any other version degrades to defaults, never to a crash.

import type { DisplayMode } from '../reader/mode.ts';

const KEY = 'reader42-prefs';

export function getDisplayMode(): DisplayMode {
  return readPrefs().displayMode === 'scroll' ? 'scroll' : 'paged';
}

export function setDisplayMode(mode: DisplayMode): void {
  writePrefs({ ...readPrefs(), displayMode: mode });
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
