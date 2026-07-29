// Reader shell: everything that wires one open book to the reader chrome.
// main.ts owns boot/transport/routing/shelf and calls openReader/closeReader;
// this module owns the controller, the TOC, and position persistence.

import { Book } from '../epub/book.ts';
import type { TocEntry } from '../epub/types.ts';
import type { DeviceCacheTransport } from '../library/device-cache.ts';
import type { Library } from '../library/store.ts';
import type { BookSidecar } from '../library/types.ts';
import { ReaderController } from '../reader/controller.ts';
import { attachReadingInput } from '../reader/input.ts';
import { bookMetrics, pageAnchors } from '../reader/metrics.ts';
import type { DisplayMode } from '../reader/mode.ts';
import { MAX_SAMPLE_SEC, createPace } from '../reader/pace.ts';
import { createChrome } from './chrome.ts';
import { el } from './dom.ts';
import {
  getDisplayMode,
  getMeasureRem,
  getPace,
  getStatusMode,
  setDisplayMode,
  setPace,
  setStatusMode,
} from './prefs.ts';
import { type StatusLine, createStatusLine, pageAt } from './status.ts';
import { currentTypography } from './typography.ts';

export interface ReaderDeps {
  library: Library;
  deviceCache: DeviceCacheTransport | null;
  /** Reveals the reader section (section visibility lives with the router). */
  showReader(): void;
}

let controller: ReaderController | null = null;
let openSidecar: BookSidecar | null = null;
let detachInput: (() => void) | null = null;
let detachEscape: (() => void) | null = null;
/** Flushes the reading-session clock and detaches its listeners. */
let teardownSession: (() => void) | null = null;

/** A stretch under this long is a peek, not a reading session (salvage §5). */
const MIN_SESSION_SEC = 30;
// Kindle parity: paginated is the default; the current value is device-local
// taste (prefs), re-read on every open and read at call time by the renderer.
let displayMode: DisplayMode = 'paged';

export async function openReader(deps: ReaderDeps, id: string): Promise<void> {
  const { library, deviceCache } = deps;
  closeReader();

  // Pin before reading: the pinned dir joins the cache's desired set
  // synchronously, so these very reads make the book fully local.
  const entry = library.index().books.find((b) => b.id === id);
  if (entry && deviceCache) void deviceCache.pin(entry.dir);

  const [bytes, sidecar] = await Promise.all([library.readEpub(id), library.readSidecar(id)]);
  if (!bytes || !sidecar) {
    location.hash = '';
    return;
  }
  const book = await Book.open(bytes);
  openSidecar = sidecar;
  // Character counts, once per open (milliseconds): the substrate for honest
  // progress weights, the location index, and time-left (parity B1/B4/B5).
  const metrics = bookMetrics(book);

  // Reading pace (B5): device-local, per book, fed with character offsets
  // (never pixels) at each position emission. Sessions (salvage §5) reuse the
  // same activity clock: time between emissions counts as reading unless the
  // gap is long enough to be an idle.
  const pace = createPace(getPace(id));
  let sessionSec = 0;
  let lastActiveMs: number | null = Date.now();

  const tickActivity = (nowMs: number): void => {
    if (lastActiveMs !== null) {
      const dt = (nowMs - lastActiveMs) / 1000;
      if (dt > 0 && dt <= MAX_SAMPLE_SEC) sessionSec += dt;
    }
    lastActiveMs = nowMs;
  };

  const flushSession = (): void => {
    if (sessionSec >= MIN_SESSION_SEC && openSidecar) {
      openSidecar = {
        ...openSidecar,
        sessions: [
          ...openSidecar.sessions,
          { seconds: Math.round(sessionSec), endedAt: new Date().toISOString() },
        ],
      };
      void library.saveSidecar(openSidecar);
    }
    sessionSec = 0;
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      tickActivity(Date.now());
      flushSession();
      lastActiveMs = null; // hidden time never counts
    } else {
      lastActiveMs = Date.now();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  teardownSession = () => {
    document.removeEventListener('visibilitychange', onVisibility);
    tickActivity(Date.now());
    flushSession();
  };

  deps.showReader();
  el<HTMLElement>('reader-book-title').textContent = sidecar.title;

  // Product law 2: opening a book lands straight in the text, chrome hidden.
  const chrome = createChrome(el<HTMLElement>('reader'));
  chrome.hide();
  displayMode = getDisplayMode();

  // End-of-book nudge (B6): one more forward turn on the last page offers
  // the finished state. Never re-nudges a finished book; never forces an
  // exit — the reader stays in the book either way.
  const finishNudge = el<HTMLElement>('finish-nudge');
  finishNudge.hidden = true; // a previous open may have left it up
  const closeFinish = (): void => {
    finishNudge.hidden = true;
  };
  const showFinish = (): void => {
    if (!openSidecar || openSidecar.state === 'finished') return;
    el<HTMLElement>('finish-book-title').textContent = openSidecar.title;
    el<HTMLElement>('finish-actions').hidden = false;
    el<HTMLElement>('finish-confirm').hidden = true;
    finishNudge.hidden = false;
  };
  el<HTMLButtonElement>('finish-not-yet').onclick = closeFinish;
  el<HTMLButtonElement>('finish-yes').onclick = () => {
    if (!openSidecar) return;
    openSidecar = {
      ...openSidecar,
      state: 'finished',
      stateChangedAt: new Date().toISOString(),
    };
    void library.saveSidecar(openSidecar);
    // A quiet confirmation, then the card slips away.
    el<HTMLElement>('finish-actions').hidden = true;
    el<HTMLElement>('finish-confirm').hidden = false;
    setTimeout(closeFinish, 1400);
  };

  const viewport = el<HTMLElement>('viewport');
  // Declared before the controller: its hooks fire during open(), and must
  // see an initialized (if still null) binding, never a TDZ hole.
  let status: StatusLine | null = null;
  controller = new ReaderController(
    book,
    viewport,
    // Taste read at call time (C8): the Aa panel writes a pref, then calls
    // controller.relayout(), and the renderer re-reads these accessors.
    { mode: () => displayMode, measureRem: getMeasureRem, typography: currentTypography },
    {
      onChapter: (index) => {
        el<HTMLElement>('reader-chapter-label').textContent =
          `${index + 1} of ${book.chapters.length}`;
        status?.refresh();
      },
      onBoundary: (edge) => {
        if (edge === 'end') showFinish();
      },
      onPosition: ({ position, progress }) => {
        if (!openSidecar) return;
        openSidecar = {
          ...openSidecar,
          position,
          progress,
          ...(openSidecar.state === 'unread'
            ? { state: 'reading' as const, stateChangedAt: position.updatedAt }
            : {}),
        };
        void library.saveSidecar(openSidecar);
        // Pace sample: the position as a global character offset.
        const now = Date.now();
        tickActivity(now);
        const chars = metrics.chapterChars[position.chapter] ?? 0;
        const fraction = controller?.currentFraction() ?? 0;
        pace.record(metrics.charsBefore(position.chapter) + fraction * chars, now);
        setPace(id, pace.state());
        status?.refresh();
      },
    },
    metrics.chapterChars,
  );
  controller.open(sidecar.position);

  // The status line (B3): live values read straight off the controller and
  // metrics, so it renders correctly immediately on open — no waiting for
  // the first debounced position save.
  const anchors = pageAnchors(book, metrics);
  const currentChars = (): number => {
    const chapter = controller?.currentChapter() ?? 0;
    const chars = metrics.chapterChars[chapter] ?? 0;
    return metrics.charsBefore(chapter) + (controller?.currentFraction() ?? 0) * chars;
  };
  status = createStatusLine(
    el<HTMLElement>('status-line'),
    el<HTMLButtonElement>('status-cycle'),
    el<HTMLElement>('status-percent'),
    {
      progress: () => controller?.progress() ?? 0,
      location: () => {
        const chapter = controller?.currentChapter() ?? 0;
        // The last page of the book is the last location, even when a short
        // final chapter reports fraction 0 for its single page (B6).
        const atBookEnd = (controller?.progress() ?? 0) >= 1;
        return {
          loc: atBookEnd
            ? metrics.totalLocations
            : metrics.locationOf(chapter, controller?.currentFraction() ?? 0),
          total: metrics.totalLocations,
        };
      },
      page: () => pageAt(anchors, currentChars()),
      minutesLeft: (scope) => {
        const chapter = controller?.currentChapter() ?? 0;
        const remaining =
          scope === 'chapter'
            ? (1 - (controller?.currentFraction() ?? 0)) * (metrics.chapterChars[chapter] ?? 0)
            : metrics.totalChars - currentChars();
        return pace.minutesFor(remaining);
      },
    },
    getStatusMode(),
    setStatusMode,
  );

  el<HTMLButtonElement>('back-to-shelf').onclick = () => {
    location.hash = '';
  };

  const modeToggle = el<HTMLButtonElement>('mode-toggle');
  const labelModeToggle = (): void => {
    modeToggle.textContent = displayMode === 'paged' ? 'Paged' : 'Scroll';
  };
  labelModeToggle();
  modeToggle.onclick = () => {
    displayMode = displayMode === 'paged' ? 'scroll' : 'paged';
    setDisplayMode(displayMode);
    labelModeToggle();
    controller?.relayout();
  };

  const toc = el<HTMLElement>('toc');
  renderToc(toc, book.toc);
  el<HTMLButtonElement>('toc-toggle').onclick = () => {
    toc.hidden = !toc.hidden;
  };

  detachInput = attachReadingInput(viewport, {
    dir: () => book.direction,
    onTurn: (d) => {
      // A page turn drops you back into pure text (parity I1).
      toc.hidden = true;
      chrome.hide();
      if (d === 'forward') controller?.turnForward();
      else controller?.turnBack();
      status?.refresh(); // same-chapter turns update the strip before the debounced save
    },
    onChrome: () => chrome.toggle(),
    keysEnabled: () => !el<HTMLElement>('reader').hidden,
  });

  // Escape only ever restores or closes (salvage §4): it closes an open
  // panel, else reveals hidden chrome; it never hides anything else.
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || el<HTMLElement>('reader').hidden) return;
    if (!finishNudge.hidden) {
      closeFinish();
      return;
    }
    if (!toc.hidden) {
      toc.hidden = true;
      return;
    }
    if (!chrome.isOpen()) chrome.reveal();
  };
  document.addEventListener('keydown', onEscape);
  detachEscape = () => document.removeEventListener('keydown', onEscape);

  // Internal links inside the chapter shadow jump within the book.
  viewport.onclick = (event) => {
    const target = event.composedPath().find((n): n is HTMLAnchorElement => {
      return n instanceof HTMLAnchorElement && n.hasAttribute('href');
    });
    if (!target) return;
    const href = target.getAttribute('href') ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // external, opens in new tab
    event.preventDefault();
    const [path, fragment] = href.split('#');
    const chapter = book.chapters[controller?.currentChapter() ?? 0];
    if (!chapter) return;
    if (!path && fragment) {
      controller?.goToChapter(controller.currentChapter(), fragment);
      return;
    }
    const resolved = resolveHref(chapter.path, path ?? '');
    controller?.goToPath(resolved, fragment ?? null);
  };
}

export function closeReader(): void {
  detachInput?.();
  detachInput = null;
  detachEscape?.();
  detachEscape = null;
  teardownSession?.(); // flush the session before the sidecar goes away
  teardownSession = null;
  controller?.dispose();
  controller = null;
  openSidecar = null;
}

function renderToc(root: HTMLElement, entries: TocEntry[]): void {
  root.replaceChildren();
  root.appendChild(tocList(entries));
}

function tocList(entries: TocEntry[]): HTMLOListElement {
  const ol = document.createElement('ol');
  for (const entry of entries) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.textContent = entry.label || '(untitled)';
    a.href = '#';
    a.addEventListener('click', (event) => {
      event.preventDefault();
      controller?.goToPath(entry.path, entry.fragment);
      el<HTMLElement>('toc').hidden = true;
    });
    li.appendChild(a);
    if (entry.children.length > 0) li.appendChild(tocList(entry.children));
    ol.appendChild(li);
  }
  return ol;
}

function resolveHref(basePath: string, href: string): string {
  const base = basePath.split('/').slice(0, -1);
  const out = [...base];
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
