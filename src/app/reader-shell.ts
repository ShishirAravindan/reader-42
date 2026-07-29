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
import { bookMetrics } from '../reader/metrics.ts';
import type { DisplayMode } from '../reader/mode.ts';
import { createChrome } from './chrome.ts';
import { el } from './dom.ts';
import { getDisplayMode, setDisplayMode } from './prefs.ts';

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

  deps.showReader();
  el<HTMLElement>('reader-book-title').textContent = sidecar.title;

  // Product law 2: opening a book lands straight in the text, chrome hidden.
  const chrome = createChrome(el<HTMLElement>('reader'));
  chrome.hide();
  displayMode = getDisplayMode();

  const viewport = el<HTMLElement>('viewport');
  controller = new ReaderController(
    book,
    viewport,
    { mode: () => displayMode },
    {
      onChapter: (index) => {
        el<HTMLElement>('reader-chapter-label').textContent =
          `${index + 1} of ${book.chapters.length}`;
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
        el<HTMLElement>('progress-label').textContent = `${Math.round(progress * 100)}%`;
        void library.saveSidecar(openSidecar);
      },
    },
    metrics.chapterChars,
  );
  controller.open(sidecar.position);
  el<HTMLElement>('progress-label').textContent = `${Math.round(sidecar.progress * 100)}%`;

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
    controller?.setMode();
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
    },
    onChrome: () => chrome.toggle(),
    keysEnabled: () => !el<HTMLElement>('reader').hidden,
  });

  // Escape only ever restores or closes (salvage §4): it closes an open
  // panel, else reveals hidden chrome; it never hides anything else.
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || el<HTMLElement>('reader').hidden) return;
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
