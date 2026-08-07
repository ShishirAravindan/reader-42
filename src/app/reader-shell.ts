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
import { newRecordId, slugify } from '../library/identity.ts';
import type { Library } from '../library/store.ts';
import type { BookSidecar, Bookmark } from '../library/types.ts';
import { ReaderController } from '../reader/controller.ts';
import { type Dictionary, createDictionary } from '../reader/dictionary.ts';
import { attachReadingInput } from '../reader/input.ts';
import {
  bookMetrics,
  excerptAt,
  excerptAtAnchor,
  pageAnchors,
  rawOffsetForFlat,
} from '../reader/metrics.ts';
import type { DisplayMode } from '../reader/mode.ts';
import { createBookSearch } from '../reader/search.ts';
import { readerSelection, wordFromSelection } from '../reader/selection.ts';
import { createAaPanel } from './aa-panel.ts';
import { type AnnotationsUI, createAnnotationsUI } from './annotations-ui.ts';
import { type Ribbon, bookmarkOnPage, createRibbon } from './bookmarks.ts';
import { createChrome } from './chrome.ts';
import { createDictionaryCard } from './dictionary-card.ts';
import { el } from './dom.ts';
import {
  type ChainLink,
  type Dismissible,
  type TurnPolicy,
  closeOthers,
  handleEscape,
  spendTurn,
} from './escape-chain.ts';
import { createFindOverlay } from './find-overlay.ts';
import { createFinishNudge } from './finish-nudge.ts';
import { createFootnotePopover } from './footnote-popover.ts';
import { createGoToPanel } from './goto-panel.ts';
import { createJumpBack, jumpBackLabel, samePlace } from './jumpback.ts';
import { attachInBookLinks } from './links.ts';
import { chapterTitles, createNotebook, logseqOutline, sortHighlights } from './notebook.ts';
import { type Peek, createPeek } from './peek.ts';
import {
  getDisplayMode,
  getMeasureChars,
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
 * Which open is current. Reading a book suspends twice (fetching the bytes,
 * then parsing them), and on a slow transport the reader can navigate away —
 * or into another book — while those awaits are outstanding. Every open takes
 * a generation and anything that ends an open bumps it, so a stale open finds
 * out and stops instead of raising a book the reader already left, over a
 * shelf that has already been drawn.
 */
let openGeneration = 0;
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
  closeReader(); // cancels any open still in flight; this one now owns the shell
  const generation = openGeneration;

  // Pin before reading: the pinned dir joins the cache's desired set
  // synchronously, so these very reads make the book fully local.
  const entry = library.index().books.find((b) => b.id === id);
  if (entry && deviceCache) void deviceCache.pin(entry.dir);

  const [bytes, sidecar] = await Promise.all([library.readEpub(id), library.readSidecar(id)]);
  if (generation !== openGeneration) return; // navigated away while loading
  if (!bytes || !sidecar) {
    location.hash = '';
    return;
  }
  const book = await Book.open(bytes);
  if (generation !== openGeneration) return;
  // Re-assert the pin now that this open owns the shell. The pin above is what
  // made the reads local; this one is what makes the device's record name the
  // book the reader actually landed on rather than one they flicked past.
  if (entry && deviceCache) void deviceCache.pin(entry.dir);
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
    { mode: () => displayMode, measureChars: getMeasureChars, typography: currentTypography },
    metrics.chapterChars,
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
          id: newRecordId(),
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
    // A jump that went nowhere leaves no way back to offer: tapping Cover
    // while already on the cover must not raise a "Back to Loc 1" pill that
    // returns the reader to where they are standing.
    if (from && !samePlace(from, controller?.currentPosition() ?? null)) {
      backStack.push({ position: from, location });
    }
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
  //
  // Through visit(), so following the link does not WRITE the reader's place.
  // A link is a look: opening a year-old one from 80% of a book must not
  // collapse the synced position back to chapter 2. Reading on from where the
  // link landed saves as usual — the visit only declines to claim the landing
  // itself.
  if (highlightId) {
    const target = openSidecar?.highlights.find((h) => h.id === highlightId);
    if (target) {
      controller.visit(() => {
        controller?.goToChapter(target.chapter);
        annotations?.reveal(target.id);
      });
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
        // final chapter reports fraction 0 for its single page (B6). The place,
        // not the percentage: a book can round to 100% a page early.
        return {
          loc: controller?.atBookEnd()
            ? metrics.totalLocations
            : metrics.locationOf(chapter, controller?.currentFraction() ?? 0),
          total: metrics.totalLocations,
        };
      },
      hasPages: () => anchors.length > 0,
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
      snippet: (bm) => excerptAtAnchor(metrics, bm.chapter, bm.anchor.path, BOOKMARK_SNIPPET_CHARS),
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
      // Opening anything means closing everything else that is up. The chain
      // knows what "everything else" is, so no call site keeps its own list —
      // six hand-copied ones had drifted into six different subsets, and none
      // of them dismissed the footnote popover, the dictionary card or a live
      // selection menu.
      onOpen: () => closeOthers(escapeChain, 'goto-panel'),
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
      onOpen: () => closeOthers(escapeChain, 'notebook'),
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
    onOpen: () => closeOthers(escapeChain, 'aa-panel'),
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
      onOpen: () => closeOthers(escapeChain, 'search'),
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
      closeOthers(escapeChain, 'peek');
      // No chrome.hide() here: the peek is opened by a GESTURE (a thumb on the
      // hairline, a swipe from the edge), and salvage §4 is that only an
      // explicit control hides chrome. Hiding it here left the reader with no
      // chrome and nothing to restore it, because closing the peek never put
      // it back.
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

  // The chain of open things, declared once, in priority order: transient
  // overlays first, then panels, then (with nothing open) the hidden chrome.
  // Every link carries its own turn policy, so there is no second list to keep
  // in step: `closes` means a page-turn input is spent dismissing it (parity
  // I1 — the turn drops you back into pure text, and the next one moves the
  // page), `blocks` means it holds something only the reader can resolve.
  const link = (name: string, turn: TurnPolicy, thing: Dismissible): ChainLink => ({
    name,
    turn,
    isOpen: () => thing.isOpen(),
    close: () => thing.close(),
  });
  const escapeChain: ChainLink[] = [
    link('finish-nudge', 'closes', finishNudge),
    // Popover, card and menu are anchored to something the reader just
    // touched, so they are nearer their attention than the peek sheet — and
    // the footnote popover's own contract is that it closes ahead of every
    // panel, which the peek is one of.
    link('footnotes', 'closes', footnotes),
    link('dict-card', 'closes', dictCard),
    {
      // The annotation layer owns its own sub-order (menu, then note editor):
      // handleEscape() closes the topmost overlay and reports that it spent
      // the press — true in exactly the cases where isOpen() is.
      name: 'annotations',
      // A serialized range and unsaved note text both die if the page moves
      // under them, and neither is the shell's to throw away.
      turn: 'blocks',
      isOpen: (): boolean => annotations?.isOpen() ?? false,
      close: (): void => {
        annotations?.handleEscape();
      },
    },
    // Closing a peek costs nothing — but a stray tap must not close it either:
    // the scrub origin is the promise that peeking is free.
    link('peek', 'blocks', peek),
    {
      name: 'search',
      turn: 'closes',
      isOpen: (): boolean => searchPanel?.isOpen() ?? false,
      close: (): void => searchPanel?.close(),
      // The panel steps aside for the page but the hits stay lit, so turns
      // from here on walk between occurrences on the page you searched for.
      dismissForTurn: (): void => searchPanel?.close({ keepMarks: true }),
    },
    link('notebook', 'closes', notebook),
    link('aa-panel', 'closes', aaPanel),
    link('goto-panel', 'closes', gotoPanel),
  ];
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || el<HTMLElement>('reader').hidden) return;
    handleEscape(escapeChain, () => {
      if (!chrome.isOpen()) chrome.reveal();
    });
  };
  const detachInput = attachReadingInput(viewport, {
    dir: () => book.direction,
    onTurn: (d) => {
      // ONE rule, three input paths (tap, swipe, key): the turn is spent
      // against the chain first. With anything open it dismisses or is
      // refused there and the page does not move — which is what keeps a
      // dictionary card from staying pinned to a DOMRect on the page you
      // left, and a selection from serializing against a view that scrolled.
      if (!spendTurn(escapeChain)) return;
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
    // Document-level keys only apply to a visible reader. What is OPEN is not
    // asked here: onTurn spends every turn against the chain, so a key, a tap
    // and a swipe in the same state do the same thing (salvage §7, "state
    // ownership is split without a rule").
    keysEnabled: () => !el<HTMLElement>('reader').hidden,
  });

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
  openGeneration += 1; // whatever open is in flight is now stale
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

const BOOKMARK_SNIPPET_CHARS = 90;
/** Three lines of preview: enough to recognize a place, not enough to read. */
const PEEK_EXCERPT_CHARS = 180;
