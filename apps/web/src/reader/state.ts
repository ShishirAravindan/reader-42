// Per-book reader state persisted to localStorage.
// Keys are namespaced by book id; the value is `{ chapter, scroll, prefs }`.

export interface ReaderPrefs {
  fontScale: number;
  theme: 'light' | 'sepia' | 'dark';
}

export interface PositionAnchorState {
  path: number[];
  ratio: number;
}

export interface ReaderPosition {
  chapter: number;
  /** Raw pixel offset — fallback when no anchor resolves. */
  scroll: number;
  /** Structural locator (see renderer.ts PositionAnchor); mode-independent. */
  anchor?: PositionAnchorState;
}

export interface ReaderState {
  position: ReaderPosition;
  prefs: ReaderPrefs;
}

const STORAGE_PREFIX = 'reader-42:book:';
const PREFS_KEY = 'reader-42:prefs';

export const DEFAULT_PREFS: ReaderPrefs = {
  fontScale: 1,
  theme: 'light',
};

export function loadGlobalPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontScale:
        typeof parsed.fontScale === 'number' && parsed.fontScale > 0
          ? parsed.fontScale
          : DEFAULT_PREFS.fontScale,
      theme:
        parsed.theme === 'light' || parsed.theme === 'sepia' || parsed.theme === 'dark'
          ? parsed.theme
          : DEFAULT_PREFS.theme,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveGlobalPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

export function loadBookState(bookId: string): ReaderState | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + bookId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReaderState>;
    if (!parsed.position) return null;
    const chapter = Number(parsed.position.chapter ?? 0);
    const scroll = Number(parsed.position.scroll ?? 0);
    const rawAnchor = parsed.position.anchor;
    const anchor =
      rawAnchor &&
      Array.isArray(rawAnchor.path) &&
      rawAnchor.path.every((step) => Number.isInteger(step) && step >= 0) &&
      typeof rawAnchor.ratio === 'number' &&
      Number.isFinite(rawAnchor.ratio)
        ? { path: rawAnchor.path, ratio: Math.min(Math.max(rawAnchor.ratio, -1), 2) }
        : undefined;
    return {
      position: {
        chapter: Number.isFinite(chapter) && chapter >= 0 ? Math.floor(chapter) : 0,
        scroll: Number.isFinite(scroll) && scroll >= 0 ? scroll : 0,
        ...(anchor ? { anchor } : {}),
      },
      prefs: { ...DEFAULT_PREFS, ...(parsed.prefs ?? {}) },
    };
  } catch {
    return null;
  }
}

export function saveBookState(bookId: string, state: ReaderState): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + bookId, JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}
