// Per-book reader state persisted to localStorage.
// Keys are namespaced by book id; the value is `{ chapter, scroll, prefs }`.

export interface ReaderPrefs {
  fontScale: number;
  theme: 'light' | 'sepia' | 'dark';
  mode: 'scroll' | 'paged';
  measure: 's' | 'm' | 'l';
  leading: 's' | 'm' | 'l';
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
const BOOKMARKS_PREFIX = 'reader-42:bookmarks:';
const PREFS_KEY = 'reader-42:prefs';

export interface Bookmark {
  chapter: number;
  anchor: PositionAnchorState;
  snippet: string;
  createdAt: number;
}

export function loadBookmarks(bookId: string): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_PREFIX + bookId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (bm): bm is Bookmark =>
        bm &&
        Number.isInteger(bm.chapter) &&
        bm.chapter >= 0 &&
        bm.anchor &&
        Array.isArray(bm.anchor.path) &&
        typeof bm.anchor.ratio === 'number' &&
        typeof bm.snippet === 'string' &&
        typeof bm.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

export function saveBookmarks(bookId: string, bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(BOOKMARKS_PREFIX + bookId, JSON.stringify(bookmarks));
  } catch {
    // ignore quota / private mode
  }
}

export const DEFAULT_PREFS: ReaderPrefs = {
  fontScale: 1,
  theme: 'light',
  mode: 'scroll',
  measure: 'm',
  leading: 'm',
};

function step(value: unknown): 's' | 'm' | 'l' | undefined {
  return value === 's' || value === 'm' || value === 'l' ? value : undefined;
}

export function sanitizePrefs(parsed: Partial<ReaderPrefs> | undefined): ReaderPrefs {
  return {
    fontScale:
      typeof parsed?.fontScale === 'number' && parsed.fontScale > 0
        ? parsed.fontScale
        : DEFAULT_PREFS.fontScale,
    theme:
      parsed?.theme === 'light' || parsed?.theme === 'sepia' || parsed?.theme === 'dark'
        ? parsed.theme
        : DEFAULT_PREFS.theme,
    mode: parsed?.mode === 'paged' || parsed?.mode === 'scroll' ? parsed.mode : DEFAULT_PREFS.mode,
    measure: step(parsed?.measure) ?? DEFAULT_PREFS.measure,
    leading: step(parsed?.leading) ?? DEFAULT_PREFS.leading,
  };
}

export function loadGlobalPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return sanitizePrefs(JSON.parse(raw) as Partial<ReaderPrefs>);
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
      prefs: sanitizePrefs(parsed.prefs),
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
