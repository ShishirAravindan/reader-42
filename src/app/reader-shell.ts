// Reader shell: everything that wires one open book to the reader chrome.
// main.ts owns boot/transport/routing/shelf and calls openReader/closeReader;
// this module owns the controller, the panels' wiring, and position persistence.
//
// Rules of their own live in modules beside this one — the Escape chain, the
// reading-session clock, the finish nudge, in-book links, the find overlay —
// so what is left here is only how one open book is wired together, and how
// it comes apart.

import { Book } from '../epub/book.ts';
import type { DeviceCacheTransport } from '../library/device-cache.ts';
import { slugify } from '../library/identity.ts';
import type { Library } from '../library/store.ts';
import type { BookSidecar, Bookmark } from '../library/types.ts';
import { ReaderController } from '../reader/controller.ts';
import { type Dictionary, createDictionary } from '../reader/dictionary.ts';
import { attachReadingInput } from '../reader/input.ts';
import { elementAtPath } from '../reader/locator.ts';
import {
  type BookMetrics,
  bookMetrics,
  excerptAt,
  pageAnchors,
  rawOffsetForFlat,
  rawOffsetOfElement,
} from '../reader/metrics.ts';
import type { DisplayMode } from '../reader/mode.ts';
import { createBookSearch } from '../reader/search.ts';
import { readerSelection, wordFromSelection } from '../reader/selection.ts';
import { createAaPanel } from './aa-panel.ts';
import { type AnnotationsUI, createAnnotationsUI } from './annotations-ui.ts';
import { type Ribbon, bookmarkOnPage, createRibbon, newBookmarkId } from './bookmarks.ts';
import { createChrome } from './chrome.ts';
import { createDictionaryCard } from './dictionary-card.ts';
import { el } from './dom.ts';
import { type Dismissible, handleEscape } from './escape-chain.ts';
import { createFindOverlay } from './find-overlay.ts';
import { createFinishNudge } from './finish-nudge.ts';
import { createFootnotePopover } from './footnote-popover.ts';
import { createGoToPanel } from './goto-panel.ts';
import { createJumpBack, jumpBackLabel } from './jumpback.ts';
import { attachInBookLinks } from './links.ts';
import { chapterTitles, createNotebook, logseqOutline, sortHighlights } from './notebook.ts';
import { type Peek, createPeek } from './peek.ts';
import {
  getDisplayMode,
  getMeasureCh,
  getPace,
  getStatusMode,
  setDisplayMode,
  setPace,
  setStatusMode,
} from './prefs.ts';
import { type SearchPanel, createSearchPanel } from './search-panel.ts';
import { trackReadingSession } from './session.ts';
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
/**
 * How one open book comes apart: closeReader() drains this in order. The shell
 * owns the lifecycle, so every listener, overlay and clock that openReader
 * brings up registers its undo here and nowhere else.
 */
const teardown: (() => void)[] = [];

// One dictionary for the app's lifetime: the 5 MB artifact is fetched on the
// FIRST lookup only (never at book open) and the parsed map stays resident,
// so later lookups — in this book or the next — resolve instantly, offline.
let dictionary: Dictionary | null = null;
function appDictionary(): Dictionary {
  dictionary ??= createDictionary(async () => {
    const res = await fetch('/dict/en-dict.json.gz');
    if (!res.ok) throw new Error(`dictionary fetch failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  return dictionary;
}

// Kindle parity: paginated is the default; the current value is device-local
// taste (prefs), re-read on every open and read at call time by the renderer.
let displayMode: DisplayMode = 'paged';

export async function openReader(
  deps: ReaderDeps,
  id: string,
  /** Deep-link target (F5): jump to this highlight and flash it after open. */
  highlightId: string | null = null,
): Promise<void> {
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

  // Reading pace and sessions (B5, salvage §5): one activity clock, fed with
  // character offsets (never pixels) at each position emission. Pace stays on
  // the device; sessions go to the sidecar through the same save path as
  // position updates.
  const session = trackReadingSession({
    savedPace: getPace(id),
    savePace: (state) => setPace(id, state),
    addSession: (row) => {
      if (!openSidecar) return;
      openSidecar = { ...openSidecar, sessions: [...openSidecar.sessions, row] };
      void library.saveSidecar(openSidecar);
    },
  });

  deps.showReader();
  el<HTMLElement>('reader-book-title').textContent = sidecar.title;

  // Product law 2: opening a book lands straight in the text, chrome hidden.
  const chrome = createChrome(el<HTMLElement>('reader'));
  chrome.hide();
  displayMode = getDisplayMode();

  const finishNudge = createFinishNudge({
    book: () =>
      openSidecar ? { title: openSidecar.title, finished: openSidecar.state === 'finished' } : null,
    markFinished: () => {
      if (!openSidecar) return;
      openSidecar = {
        ...openSidecar,
        state: 'finished',
        stateChangedAt: new Date().toISOString(),
      };
      void library.saveSidecar(openSidecar);
    },
  });

  const viewport = el<HTMLElement>('viewport');
  // Declared before the controller: its hooks fire during open(), and must
  // see an initialized (if still null) binding, never a TDZ hole.
  let status: StatusLine | null = null;
  let annotations: AnnotationsUI | null = null;
  let ribbon: Ribbon | null = null;
  let searchPanel: SearchPanel | null = null;

  const findOverlay = createFindOverlay({
    view: () => controller?.chapterView() ?? null,
    chapter: () => controller?.currentChapter() ?? 0,
    hits: () => searchPanel?.hits() ?? [],
  });

  controller = new ReaderController(
    book,
    viewport,
    // Taste read at call time (C8): the Aa panel writes a pref, then calls
    // controller.relayout(), and the renderer re-reads these accessors.
    { mode: () => displayMode, measureCh: getMeasureCh, typography: currentTypography },
    {
      onChapter: (index) => {
        // The chapter number is no longer chrome (the contents panel and the
        // peek preview both name chapters properly, and while reading a count
        // earned nothing). It stays on the section as reader state, for styling
        // and for the acceptance scenes, 1-based as a human would say it.
        el<HTMLElement>('reader').dataset.chapter = String(index + 1);
        // Every chapter render starts from a mark-free tree; re-apply the
        // sidecar's highlights for it (stale ones silently don't render), and
        // the active query's hits for this chapter.
        annotations?.applyChapter();
        findOverlay.applyChapter();
        status?.refresh();
        ribbon?.refresh();
      },
      onBoundary: (edge) => {
        if (edge === 'end') finishNudge.show();
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
        const chars = metrics.chapterChars[position.chapter] ?? 0;
        const fraction = controller?.currentFraction() ?? 0;
        session.record(metrics.charsBefore(position.chapter) + fraction * chars, Date.now());
        status?.refresh();
        ribbon?.refresh();
      },
    },
    metrics.chapterChars,
  );

  // Deep-link URLs keep the transport query (?lib=…) so a pasted link boots
  // the same library the copier was reading from.
  const linkFor = (hid: string): string =>
    `${location.origin}${location.pathname}${location.search}#/book/${id}/hl/${hid}`;

  // The dictionary card (E1): opened by double-clicking a word (the native
  // long-press word selection routes through the same selection path on
  // touch) and by the selection menu's Look up.
  const dictCard = createDictionaryCard(appDictionary(), {
    passThrough: () => [el<HTMLElement>('selection-menu')],
  });
  viewport.ondblclick = (): void => {
    const view = controller?.chapterView();
    const range = view ? readerSelection(view.shadow) : null;
    const word = range ? wordFromSelection(range) : null;
    if (word) dictCard.show(word);
  };

  // The annotation layer (E2, F1–F3): selection menu, notes, mark overlays.
  // Persistence writes the whole sidecar through the same save path as
  // position updates; no second storage route.
  annotations = createAnnotationsUI({
    reader: el<HTMLElement>('reader'),
    viewport,
    current: () => controller?.chapterView() ?? null,
    chapterIndex: () => controller?.currentChapter() ?? 0,
    highlights: () => openSidecar?.highlights ?? [],
    setHighlights: (next) => {
      if (!openSidecar) return;
      openSidecar = { ...openSidecar, highlights: next };
      void library.saveSidecar(openSidecar);
    },
    lookup: (text) => dictCard.show(text),
    searchInBook: (text) => searchPanel?.open(text),
    linkFor,
  });

  // Bookmarks (G1/G2): the corner gesture toggles the visible page's mark and
  // the dog-ear ribbon shows it. Everything reads the SYNCED sidecar — there
  // is no device-local bookmark store (the salvage §7 debt this fixes).
  const bookmarks = (): Bookmark[] => openSidecar?.bookmarks ?? [];
  const setBookmarks = (next: Bookmark[]): void => {
    if (!openSidecar) return;
    openSidecar = { ...openSidecar, bookmarks: next };
    void library.saveSidecar(openSidecar);
  };
  const bookmarkHere = (): Bookmark | null => {
    const view = controller;
    if (!view) return null;
    return bookmarkOnPage(bookmarks(), view.currentChapter(), (b) =>
      view.anchorInView(b.chapter, b.anchor),
    );
  };
  ribbon = createRibbon(el<HTMLElement>('bookmark-ribbon'), { current: bookmarkHere });
  const toggleBookmarkHere = (): void => {
    const existing = bookmarkHere();
    if (existing) {
      setBookmarks(bookmarks().filter((b) => b.id !== existing.id));
    } else {
      const anchor = controller?.currentAnchor();
      if (!anchor) return;
      setBookmarks([
        ...bookmarks(),
        {
          id: newBookmarkId(),
          chapter: controller?.currentChapter() ?? 0,
          anchor,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    ribbon?.refresh();
  };

  // The jump-back stack (H3): anything that is not a page turn records where
  // the reader was, and the pill offers the way back. Wrapping the jump — not
  // the destination — keeps every caller a one-liner and the rule in one place.
  const backStack = createJumpBack();
  const backPill = el<HTMLButtonElement>('jump-back');
  const renderPill = (): void => {
    const { visible, entry } = backStack.state();
    backPill.hidden = !visible || !entry;
    if (entry) backPill.textContent = jumpBackLabel(entry);
  };
  renderPill();
  const jumpFrom = (run: () => void): void => {
    const from = controller?.currentPosition() ?? null;
    // The label is the place BEFORE the jump, so read the location first.
    const location = from
      ? metrics.locationOf(from.chapter, controller?.currentFraction() ?? 0)
      : 1;
    run();
    if (from) backStack.push({ position: from, location });
    renderPill();
  };
  backPill.onclick = (event): void => {
    event.stopPropagation(); // never reaches the tap zones: no page turn
    const entry = backStack.pop();
    if (entry) controller?.goToPosition(entry.position);
    renderPill();
  };

  controller.open(sidecar.position);

  // A deep link (F5) lands on its highlight, flashed; the address bar keeps
  // the copyable link (salvage §4) — routing never rewrites it.
  if (highlightId) {
    const target = openSidecar?.highlights.find((h) => h.id === highlightId);
    if (target) {
      controller.goToChapter(target.chapter);
      annotations.reveal(target.id);
    }
  }

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
    {
      strip: el<HTMLElement>('status-line'),
      cycle: el<HTMLButtonElement>('status-cycle'),
      progress: el<HTMLElement>('status-progress'),
      percent: el<HTMLElement>('status-percent'),
    },
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
        return session.paceMinutesFor(remaining);
      },
    },
    getStatusMode(),
    setStatusMode,
  );

  el<HTMLButtonElement>('back-to-shelf').onclick = () => {
    location.hash = '';
  };

  // Human chapter titles, from the toc (salvage §5: never spine indices).
  // Shared by the notebook, the Go To bookmark rows, and the peek preview.
  const titles = chapterTitles(book.toc, book.chapters.length, (p) => book.chapterIndexByPath(p));
  const chapterTitleFor = (chapter: number): string => titles[chapter] ?? `Chapter ${chapter + 1}`;

  // The Go To panel (H1/G2): Cover, Beginning, page-or-location entry, the
  // contents, and the bookmark list. The panel resolves what the reader asked
  // for; every jump goes through the shell so the back stack sees it.
  const gotoPanel = createGoToPanel(
    el<HTMLElement>('goto-panel'),
    el<HTMLButtonElement>('toc-toggle'),
    {
      contents: el<HTMLElement>('toc'),
      toc: book.toc,
      goToTocEntry: (tocEntry) => {
        jumpFrom(() => controller?.goToPath(tocEntry.path, tocEntry.fragment));
      },
      bookmarks,
      chapterTitle: chapterTitleFor,
      snippet: (bm) => bookmarkSnippet(metrics, bm),
      pages: () => anchors,
      totalLocations: () => metrics.totalLocations,
      goToCover: () => jumpFrom(() => controller?.goToChapter(0)),
      goToBeginning: () => jumpFrom(() => controller?.goToChapter(book.beginning)),
      goToTarget: (target) => {
        const place =
          target.kind === 'page'
            ? metrics.placeAtChar(target.globalChar)
            : metrics.placeAtLocation(target.location);
        jumpFrom(() => controller?.goToFraction(place.chapter, place.fraction));
      },
      goToBookmark: (bm) => {
        jumpFrom(() =>
          controller?.goToPosition({
            chapter: bm.chapter,
            anchor: bm.anchor,
            updatedAt: new Date().toISOString(),
          }),
        );
      },
      removeBookmark: (bm) => {
        setBookmarks(bookmarks().filter((b) => b.id !== bm.id));
        ribbon?.refresh();
      },
      onOpen: () => {
        notebook.close();
        aaPanel.close();
        searchPanel?.close();
      },
    },
  );
  const notebook = createNotebook(
    el<HTMLElement>('notebook'),
    el<HTMLButtonElement>('notebook-toggle'),
    {
      highlights: () => openSidecar?.highlights ?? [],
      chapterTitle: chapterTitleFor,
      jumpTo: (hl) => {
        // Through the controller first: the chapter renders (and its marks
        // re-apply) before any geometry is resolved for the flash.
        jumpFrom(() => {
          controller?.goToChapter(hl.chapter);
          annotations?.reveal(hl.id);
        });
      },
      exportFile: () => ({
        name: `${slugify(openSidecar?.title ?? 'book')}-highlights.md`,
        content: logseqOutline(
          openSidecar?.title ?? '',
          sortHighlights(openSidecar?.highlights ?? []).map((hl) => ({
            text: hl.text,
            chapterTitle: chapterTitleFor(hl.chapter),
            link: linkFor(hl.id),
            ...(hl.note ? { note: hl.note } : {}),
          })),
        ),
      }),
      onOpen: () => {
        gotoPanel.close();
        aaPanel.close();
        searchPanel?.close();
      },
    },
  );

  // The Aa panel (C1-C6/D1): controls write device-local prefs; reflowing
  // ones call relayout(), which re-reads the ReaderView accessors above.
  const aaPanel = createAaPanel(el<HTMLElement>('aa-panel'), el<HTMLButtonElement>('aa-toggle'), {
    relayout: () => {
      controller?.relayout();
      status?.refresh();
    },
    displayMode: () => displayMode,
    setDisplayMode: (mode) => {
      displayMode = mode;
      setDisplayMode(mode);
      controller?.relayout();
      status?.refresh();
      ribbon?.refresh(); // the same bookmark, judged against the new geometry
    },
    onOpen: () => {
      gotoPanel.close();
      notebook.close();
      searchPanel?.close();
    },
  });

  // In-book search (H5). The book's text comes from metrics, which parses and
  // sanitizes each chapter exactly as the renderer does — so a hit's offsets
  // address the very text nodes the marks will wrap.
  const bookSearch = createBookSearch(book.chapters.length, metrics.chapterText);
  searchPanel = createSearchPanel(
    el<HTMLElement>('search-panel'),
    el<HTMLButtonElement>('search-toggle'),
    {
      search: bookSearch.search,
      chapterTitle: chapterTitleFor,
      jumpTo: (hit, index) => {
        jumpFrom(() => {
          // goToChapter renders, which re-applies this chapter's marks; then
          // the geometry is live and the hit can be revealed and flashed.
          controller?.goToChapter(hit.chapter);
          findOverlay.applyChapter();
          findOverlay.reveal(index);
        });
      },
      onCleared: () => findOverlay.clear(),
      onOpen: () => {
        gotoPanel.close();
        notebook.close();
        aaPanel.close();
      },
    },
  );

  // The Page Flip peek (H4). Everything it shows is derived from character
  // metrics, so scrubbing renders nothing and moves nothing: the reading
  // position only changes when the reader confirms with Go.
  const peek: Peek = createPeek(el<HTMLElement>('peek-sheet'), {
    currentLocation: () =>
      metrics.locationOf(controller?.currentChapter() ?? 0, controller?.currentFraction() ?? 0),
    totalLocations: () => metrics.totalLocations,
    chapterChars: () => metrics.chapterChars,
    preview: (location) => {
      const place = metrics.placeAtLocation(location);
      const raw = metrics.chapterText(place.chapter);
      const flatInto = place.fraction * (metrics.chapterChars[place.chapter] ?? 0);
      return {
        location,
        chapterTitle: chapterTitleFor(place.chapter),
        excerpt: excerptAt(raw, rawOffsetForFlat(raw, flatInto), PEEK_EXCERPT_CHARS),
      };
    },
    goTo: (location) => {
      const place = metrics.placeAtLocation(location);
      jumpFrom(() => controller?.goToFraction(place.chapter, place.fraction));
    },
    onOpen: () => {
      gotoPanel.close();
      notebook.close();
      aaPanel.close();
      searchPanel?.close({ keepMarks: true });
      chrome.hide();
    },
  });
  // The progress rule IS the way to look elsewhere: tapping the hairline opens
  // the peek (the swipe-up gesture is unchanged). The readout beside it keeps
  // its own tap, so the two never trade places.
  el<HTMLButtonElement>('status-track').onclick = (event): void => {
    event.stopPropagation(); // never reaches the tap zones: no page turn
    if (peek.isOpen()) peek.close();
    else peek.open();
  };

  // The footnote popover (H2): a transient overlay, so it closes ahead of
  // every panel in the Escape chain and steps aside for a page turn.
  const footnotes = createFootnotePopover(
    el<HTMLElement>('footnote-popover'),
    el<HTMLElement>('footnote-body'),
    el<HTMLButtonElement>('footnote-goto'),
    el<HTMLElement>('reader'),
  );

  const detachInput = attachReadingInput(viewport, {
    dir: () => book.direction,
    onTurn: (d) => {
      // A page turn drops you back into pure text (parity I1).
      footnotes.close();
      gotoPanel.close();
      notebook.close();
      // The panel steps aside; the hits stay lit, so a turn can walk between
      // occurrences on the page you searched for.
      searchPanel?.close({ keepMarks: true });
      peek.close();
      chrome.hide();
      if (d === 'forward') controller?.turnForward();
      else controller?.turnBack();
      status?.refresh(); // same-chapter turns update the strip before the debounced save
      ribbon?.refresh(); // ...and so does the dog-ear
      backStack.turn(); // three turns and the pill settles away
      renderPill();
    },
    onChrome: () => chrome.toggle(),
    onCorner: toggleBookmarkHere,
    onPeek: () => peek.open(),
    // In scroll mode a vertical swipe is a scroll; the gesture stands down.
    peekEnabled: () => displayMode === 'paged',
    // Keyboard turns pause while the Aa panel or an annotation overlay is up.
    keysEnabled: () =>
      !el<HTMLElement>('reader').hidden &&
      !aaPanel.isOpen() &&
      !(searchPanel?.isOpen() ?? false) &&
      !peek.isOpen() &&
      !dictCard.isOpen() &&
      !(annotations?.isOpen() ?? false),
  });

  // The Escape chain, declared once, in priority order: transient overlays
  // first, then panels, then (with nothing open) the hidden chrome.
  const escapeChain: Dismissible[] = [
    finishNudge,
    peek, // closing a peek costs nothing: the position never moved
    footnotes,
    dictCard,
    {
      // The annotation layer owns its own sub-order (menu, then note editor):
      // handleEscape() closes the topmost overlay and reports that it spent
      // the press — true in exactly the cases where isOpen() is.
      isOpen: (): boolean => annotations?.isOpen() ?? false,
      close: (): void => {
        annotations?.handleEscape();
      },
    },
    {
      isOpen: (): boolean => searchPanel?.isOpen() ?? false,
      close: (): void => searchPanel?.close(),
    },
    notebook,
    aaPanel,
    gotoPanel,
  ];
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || el<HTMLElement>('reader').hidden) return;
    handleEscape(escapeChain, () => {
      if (!chrome.isOpen()) chrome.reveal();
    });
  };
  document.addEventListener('keydown', onEscape);

  const detachLinks = attachInBookLinks(viewport, {
    currentView: () => controller?.chapterView() ?? null,
    currentChapter: () => controller?.currentChapter() ?? 0,
    chapterPath: (chapter) => book.chapters[chapter]?.path ?? null,
    footnotes,
    jumpFrom,
    goToChapter: (chapter, fragment) => {
      controller?.goToChapter(chapter, fragment);
    },
    goToPath: (path, fragment) => {
      controller?.goToPath(path, fragment);
    },
  });

  // The undo of everything above, in the order closeReader drains it: the
  // input and Escape listeners stop reaching the overlays before those go, and
  // the session flushes while its sidecar is still open.
  teardown.push(
    detachInput,
    () => document.removeEventListener('keydown', onEscape),
    detachLinks,
    annotations.dispose,
    dictCard.dispose,
    notebook.close,
    gotoPanel.close,
    footnotes.dispose,
    () => searchPanel?.close(),
    peek.close,
    aaPanel.close,
    session.teardown, // flush the session before the sidecar goes away
  );
}

export function closeReader(): void {
  for (const undo of teardown.splice(0)) undo();
  // Unconditional, so the chrome that overlays the page is down even when the
  // router closes a reader that was never opened.
  const pill = document.getElementById('jump-back');
  if (pill) pill.hidden = true;
  const ribbonEl = document.getElementById('bookmark-ribbon');
  if (ribbonEl) ribbonEl.hidden = true;
  controller?.dispose();
  controller = null;
  openSidecar = null;
}

/**
 * What sits at a bookmark, without rendering its chapter: resolve the
 * structural anchor against the parsed chapter body, turn it into a raw text
 * offset, and excerpt from the chapter's text. Layout-free, so the Go To
 * panel can describe pages the reader is nowhere near.
 */
function bookmarkSnippet(metrics: BookMetrics, bookmark: Bookmark): string {
  const body = metrics.chapterBody(bookmark.chapter);
  if (!body) return '';
  const element = elementAtPath(body, bookmark.anchor.path) ?? body;
  const offset = rawOffsetOfElement(body, element) ?? 0;
  return excerptAt(metrics.chapterText(bookmark.chapter), offset, BOOKMARK_SNIPPET_CHARS);
}

const BOOKMARK_SNIPPET_CHARS = 90;
/** Three lines of preview: enough to recognize a place, not enough to read. */
const PEEK_EXCERPT_CHARS = 180;
