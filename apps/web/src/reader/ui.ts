// Reader UI controller.
//
// Wires the parsed Book to the host page DOM:
//   - Title / author header
//   - Collapsible TOC sidebar (with nested entries)
//   - Chapter viewport (delegates to renderer)
//   - Prev / next + arrow keys
//   - Font size + theme controls
//   - Position + prefs persistence

import type { Book, Chapter, TocEntry } from '../epub/index.ts';
import {
  type PositionAnchor,
  type RenderedChapter,
  applyOptions,
  renderChapter,
} from './renderer.ts';
import {
  type Bookmark,
  DEFAULT_PREFS,
  type ReaderPrefs,
  loadBookState,
  loadBookmarks,
  loadGlobalPrefs,
  saveBookState,
  saveBookmarks,
  saveGlobalPrefs,
} from './state.ts';

export interface ReaderElements {
  root: HTMLElement;
  toc: HTMLElement;
  viewport: HTMLElement;
  title: HTMLElement;
  author: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  fontButtons: HTMLButtonElement[];
  themeButtons: HTMLButtonElement[];
  modeButtons: HTMLButtonElement[];
  measureButtons: HTMLButtonElement[];
  leadingButtons: HTMLButtonElement[];
  typoToggle: HTMLButtonElement;
  typoPanel: HTMLElement;
  tocToggle: HTMLButtonElement;
  chapterLabel: HTMLElement;
  bookmarkBtn: HTMLButtonElement;
  bookmarksTitle: HTMLElement;
  bookmarksList: HTMLElement;
}

const FONT_SCALES: Record<'s' | 'm' | 'l', number> = { s: 0.9, m: 1, l: 1.15 };

export class ReaderUI {
  private readonly elements: ReaderElements;
  private book: Book | null = null;
  private rendered: RenderedChapter | null = null;
  private chapterIndex = 0;
  private prefs: ReaderPrefs;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private bookmarks: Bookmark[] = [];

  constructor(elements: ReaderElements) {
    this.elements = elements;
    this.prefs = loadGlobalPrefs();
    this.bindControls();
    this.refreshControlState();
  }

  open(book: Book): void {
    this.tearDown();
    this.book = book;

    // Restore saved state for this book if any; default to ch 0 + scroll 0.
    const saved = loadBookState(book.id);
    if (saved) {
      this.prefs = saved.prefs;
    }
    const startChapter = saved?.position.chapter ?? 0;
    const startScroll = saved?.position.scroll ?? 0;

    this.elements.title.textContent = book.metadata.title;
    this.elements.author.textContent = book.metadata.author;
    this.renderToc(book.toc);
    this.bookmarks = loadBookmarks(book.id);
    this.renderBookmarks();
    this.refreshControlState();

    const safeIndex = Math.min(Math.max(startChapter, 0), book.chapters.length - 1);
    this.goToChapter(safeIndex, { scroll: startScroll, anchor: saved?.position.anchor ?? null });
  }

  private bindControls(): void {
    const {
      prevBtn,
      nextBtn,
      fontButtons,
      themeButtons,
      modeButtons,
      measureButtons,
      leadingButtons,
      typoToggle,
      typoPanel,
      tocToggle,
      viewport,
    } = this.elements;

    prevBtn.addEventListener('click', () => this.goPrev());
    nextBtn.addEventListener('click', () => this.goNext());

    const prefButton = (
      buttons: HTMLButtonElement[],
      read: (btn: HTMLButtonElement) => Partial<ReaderPrefs> | null,
    ): void => {
      for (const btn of buttons) {
        btn.addEventListener('click', () => {
          const patch = read(btn);
          if (!patch) return;
          this.prefs = { ...this.prefs, ...patch };
          this.applyPrefs();
          this.persist();
        });
      }
    };

    prefButton(fontButtons, (btn) => {
      const size = btn.dataset.size as 's' | 'm' | 'l' | undefined;
      return size ? { fontScale: FONT_SCALES[size] } : null;
    });
    prefButton(themeButtons, (btn) => {
      const theme = btn.dataset.theme as ReaderPrefs['theme'] | undefined;
      return theme ? { theme } : null;
    });
    prefButton(modeButtons, (btn) => {
      const mode = btn.dataset.mode as ReaderPrefs['mode'] | undefined;
      return mode ? { mode } : null;
    });
    prefButton(measureButtons, (btn) => {
      const measure = btn.dataset.measure as ReaderPrefs['measure'] | undefined;
      return measure ? { measure } : null;
    });
    prefButton(leadingButtons, (btn) => {
      const leading = btn.dataset.leading as ReaderPrefs['leading'] | undefined;
      return leading ? { leading } : null;
    });

    typoToggle.addEventListener('click', () => {
      const open = typoPanel.hidden;
      typoPanel.hidden = !open;
      typoToggle.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (typoPanel.hidden) return;
      const path = event.composedPath();
      if (path.includes(typoPanel) || path.includes(typoToggle)) return;
      typoPanel.hidden = true;
      typoToggle.setAttribute('aria-expanded', 'false');
    });

    tocToggle.addEventListener('click', () => {
      this.elements.root.classList.toggle('toc-collapsed');
    });

    this.elements.bookmarkBtn.addEventListener('click', () => this.toggleBookmark());

    viewport.addEventListener(
      'scroll',
      () => {
        this.schedulePersist();
        this.updateChapterLabel();
      },
      { passive: true },
    );
    viewport.addEventListener('click', (event) => this.onViewportClick(event));

    // Swipe page turns (paged mode).
    let touchStartX = 0;
    let touchStartY = 0;
    viewport.addEventListener(
      'touchstart',
      (event) => {
        const touch = event.touches[0];
        if (!touch) return;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      },
      { passive: true },
    );
    viewport.addEventListener(
      'touchend',
      (event) => {
        if (this.prefs.mode !== 'paged') return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - touchStartX;
        const dy = touch.clientY - touchStartY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2) return;
        if (dx < 0) this.goNext();
        else this.goPrev();
      },
      { passive: true },
    );

    // Reflow pages on resize, keeping the position via the anchor.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    window.addEventListener('resize', () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (!this.rendered || this.prefs.mode !== 'paged') return;
        const anchor = this.rendered.getAnchor();
        applyOptions(this.rendered.host, this.renderOptions());
        if (anchor) this.rendered.scrollToAnchor(anchor);
        this.updateChapterLabel();
      }, 150);
    });

    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        this.goNext();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        this.goPrev();
      }
    });
  }

  private onViewportClick(event: MouseEvent): void {
    // Intercept intra-EPUB <a href="..."> clicks bubbled out of the shadow.
    const path = event.composedPath();
    let anchor: HTMLAnchorElement | null = null;
    for (const node of path) {
      if (node instanceof HTMLAnchorElement) {
        anchor = node;
        break;
      }
    }
    if (!anchor) {
      // No link under the tap: in paged mode the side thirds are page-turn
      // zones (unless the tap was a text selection).
      if (this.prefs.mode !== 'paged') return;
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) return;
      const bounds = this.elements.viewport.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
      if (x < 0.3) this.goPrev();
      else if (x > 0.7) this.goNext();
      return;
    }
    const href = anchor.getAttribute('href');
    if (!href) return;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('blob:')) return; // external
    if (!this.book || !this.rendered) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      this.rendered.scrollToFragment(href.slice(1));
      return;
    }
    // Resolve href against current chapter path.
    const chapter = this.book.chapters[this.chapterIndex];
    if (!chapter) return;
    const resolved = resolveAgainstPath(chapter.path, decodeURI(href.split('#')[0] ?? ''));
    const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : null;
    const target = this.book.chapters.findIndex((c) => c.path === resolved);
    if (target >= 0) this.goToChapter(target, { fragment });
  }

  private goPrev(): void {
    if (!this.book) return;
    // In paged mode step a page first; cross the chapter edge onto its last page.
    if (this.rendered?.pageBy(-1)) {
      this.afterPageTurn();
      return;
    }
    if (this.chapterIndex <= 0) return;
    this.goToChapter(this.chapterIndex - 1, { atEnd: this.prefs.mode === 'paged' });
  }

  private goNext(): void {
    if (!this.book) return;
    if (this.rendered?.pageBy(1)) {
      this.afterPageTurn();
      return;
    }
    if (this.chapterIndex >= this.book.chapters.length - 1) return;
    this.goToChapter(this.chapterIndex + 1);
  }

  private afterPageTurn(): void {
    this.updateChapterLabel();
    this.schedulePersist();
  }

  private renderOptions(): Parameters<typeof renderChapter>[3] {
    return {
      fontScale: this.prefs.fontScale,
      theme: this.prefs.theme,
      mode: this.prefs.mode,
      measure: this.prefs.measure,
      leading: this.prefs.leading,
    };
  }

  private goToChapter(
    index: number,
    opts: {
      scroll?: number;
      anchor?: PositionAnchor | null;
      fragment?: string | null;
      atEnd?: boolean;
    } = {},
  ): void {
    if (!this.book) return;
    const chapter = this.book.chapters[index];
    if (!chapter) return;
    if (this.rendered) this.rendered.dispose();
    this.chapterIndex = index;
    this.elements.viewport.dataset.mode = this.prefs.mode;
    this.rendered = renderChapter(this.book, chapter, this.elements.viewport, this.renderOptions());
    // Structural anchor wins over the raw pixel offset when it resolves.
    if (opts.anchor && opts.anchor.path.length > 0) this.rendered.scrollToAnchor(opts.anchor);
    else if (opts.atEnd) this.rendered.scrollToEnd();
    else this.rendered.setScroll(opts.scroll ?? 0);
    if (opts.fragment) {
      // Fragment scrolling needs to happen after the browser positions the
      // shadow DOM content; a microtask is sufficient.
      queueMicrotask(() => this.rendered?.scrollToFragment(opts.fragment ?? ''));
    }
    this.updateChapterLabel();
    this.refreshControlState();
    this.highlightTocFor(chapter);
    this.persist();
  }

  private updateChapterLabel(): void {
    const book = this.book;
    const chapter = book?.chapters[this.chapterIndex];
    if (!book || !chapter) return;
    const base = chapter.title
      ? `${this.chapterIndex + 1} of ${book.chapters.length}: ${chapter.title}`
      : `${this.chapterIndex + 1} of ${book.chapters.length}`;
    const info = this.rendered?.pageInfo();
    this.elements.chapterLabel.textContent =
      info && info.pages > 1 ? `${base} · p. ${info.page}/${info.pages}` : base;
    this.refreshBookmarkButton();
  }

  // --- bookmarks ---

  private currentAnchor(): { chapter: number; anchor: Bookmark['anchor'] } | null {
    if (!this.rendered) return null;
    return {
      chapter: this.chapterIndex,
      anchor: this.rendered.getAnchor() ?? { path: [], ratio: 0 },
    };
  }

  private bookmarkIndexAt(chapter: number, path: number[]): number {
    return this.bookmarks.findIndex(
      (bm) =>
        bm.chapter === chapter &&
        bm.anchor.path.length === path.length &&
        bm.anchor.path.every((step, i) => step === path[i]),
    );
  }

  private toggleBookmark(): void {
    const book = this.book;
    const position = this.currentAnchor();
    if (!book || !position || !this.rendered) return;
    const existing = this.bookmarkIndexAt(position.chapter, position.anchor.path);
    if (existing >= 0) {
      this.bookmarks.splice(existing, 1);
    } else {
      const chapterTitle =
        book.chapters[position.chapter]?.title ?? `Chapter ${position.chapter + 1}`;
      const snippet = this.rendered.textAt(position.anchor) ?? chapterTitle;
      this.bookmarks.push({
        chapter: position.chapter,
        anchor: position.anchor,
        snippet: snippet.slice(0, 70),
        createdAt: Date.now(),
      });
      this.bookmarks.sort((a, b) => a.chapter - b.chapter);
    }
    saveBookmarks(book.id, this.bookmarks);
    this.renderBookmarks();
    this.refreshBookmarkButton();
  }

  private refreshBookmarkButton(): void {
    const position = this.currentAnchor();
    const marked = position
      ? this.bookmarkIndexAt(position.chapter, position.anchor.path) >= 0
      : false;
    this.elements.bookmarkBtn.classList.toggle('is-active', marked);
    this.elements.bookmarkBtn.setAttribute('aria-pressed', String(marked));
  }

  private renderBookmarks(): void {
    const { bookmarksList, bookmarksTitle } = this.elements;
    bookmarksTitle.hidden = this.bookmarks.length === 0;
    bookmarksList.replaceChildren(
      ...this.bookmarks.map((bm, index) => {
        const li = document.createElement('li');
        li.className = 'bm-item';
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'bm-link';
        const where = document.createElement('span');
        where.className = 'bm-where';
        where.textContent = this.book?.chapters[bm.chapter]?.title ?? `Chapter ${bm.chapter + 1}`;
        const snippet = document.createElement('span');
        snippet.className = 'bm-snippet';
        snippet.textContent = bm.snippet;
        go.append(where, snippet);
        go.addEventListener('click', () => this.goToChapter(bm.chapter, { anchor: bm.anchor }));
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'bm-remove';
        remove.setAttribute('aria-label', 'Remove bookmark');
        remove.textContent = '×';
        remove.addEventListener('click', () => {
          this.bookmarks.splice(index, 1);
          if (this.book) saveBookmarks(this.book.id, this.bookmarks);
          this.renderBookmarks();
          this.refreshBookmarkButton();
        });
        li.append(go, remove);
        return li;
      }),
    );
  }

  private renderToc(entries: TocEntry[]): void {
    this.elements.toc.replaceChildren();
    if (entries.length === 0) {
      // Fallback to spine if nav is empty.
      const list = document.createElement('ol');
      list.className = 'toc-list';
      const chapters = this.book?.chapters ?? [];
      for (const chapter of chapters) {
        list.appendChild(this.tocItemFromChapter(chapter));
      }
      this.elements.toc.appendChild(list);
      return;
    }
    const list = this.tocList(entries);
    this.elements.toc.appendChild(list);
  }

  private tocList(entries: TocEntry[]): HTMLOListElement {
    const ol = document.createElement('ol');
    ol.className = 'toc-list';
    for (const entry of entries) {
      const li = document.createElement('li');
      li.className = 'toc-item';
      if (entry.path) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-link';
        btn.textContent = entry.label || entry.path;
        btn.dataset.path = entry.path;
        btn.dataset.fragment = entry.fragment ?? '';
        btn.addEventListener('click', () => this.navigateToTocEntry(entry));
        li.appendChild(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'toc-label';
        span.textContent = entry.label;
        li.appendChild(span);
      }
      if (entry.children.length > 0) li.appendChild(this.tocList(entry.children));
      ol.appendChild(li);
    }
    return ol;
  }

  private tocItemFromChapter(chapter: Chapter): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'toc-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toc-link';
    btn.textContent = chapter.title ?? `Chapter ${chapter.index + 1}`;
    btn.dataset.path = chapter.path;
    btn.dataset.fragment = '';
    btn.addEventListener('click', () => this.goToChapter(chapter.index));
    li.appendChild(btn);
    return li;
  }

  private navigateToTocEntry(entry: TocEntry): void {
    if (!this.book) return;
    const target = this.book.chapters.findIndex((c) => c.path === entry.path);
    if (target < 0) return;
    this.goToChapter(target, { fragment: entry.fragment });
  }

  private highlightTocFor(chapter: Chapter): void {
    const buttons = this.elements.toc.querySelectorAll<HTMLButtonElement>('.toc-link');
    for (const btn of Array.from(buttons)) {
      btn.classList.toggle('is-current', btn.dataset.path === chapter.path);
    }
  }

  private refreshControlState(): void {
    const total = this.book?.chapters.length ?? 0;
    this.elements.prevBtn.disabled = this.chapterIndex <= 0 || total === 0;
    this.elements.nextBtn.disabled = this.chapterIndex >= total - 1 || total === 0;
    for (const btn of this.elements.fontButtons) {
      const size = btn.dataset.size as 's' | 'm' | 'l' | undefined;
      btn.classList.toggle(
        'is-active',
        size !== undefined && FONT_SCALES[size] === this.prefs.fontScale,
      );
    }
    for (const btn of this.elements.themeButtons) {
      btn.classList.toggle('is-active', btn.dataset.theme === this.prefs.theme);
    }
    for (const btn of this.elements.modeButtons) {
      btn.classList.toggle('is-active', btn.dataset.mode === this.prefs.mode);
    }
    for (const btn of this.elements.measureButtons) {
      btn.classList.toggle('is-active', btn.dataset.measure === this.prefs.measure);
    }
    for (const btn of this.elements.leadingButtons) {
      btn.classList.toggle('is-active', btn.dataset.leading === this.prefs.leading);
    }
    this.elements.root.dataset.theme = this.prefs.theme;
    this.elements.viewport.dataset.mode = this.prefs.mode;
  }

  private applyPrefs(): void {
    if (this.rendered) {
      // Capture the anchor under the old layout, apply the new one, then
      // re-anchor: this is what carries a position across font, measure,
      // leading, and display-mode changes alike.
      const anchor = this.rendered.getAnchor();
      this.elements.viewport.dataset.mode = this.prefs.mode;
      applyOptions(this.rendered.host, this.renderOptions());
      if (anchor) this.rendered.scrollToAnchor(anchor);
    }
    saveGlobalPrefs(this.prefs);
    this.refreshControlState();
    this.updateChapterLabel();
  }

  private schedulePersist(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persist();
    }, 250);
  }

  private persist(): void {
    if (!this.book || !this.rendered) return;
    const anchor = this.rendered.getAnchor();
    saveBookState(this.book.id, {
      position: {
        chapter: this.chapterIndex,
        scroll: this.rendered.getScroll(),
        ...(anchor ? { anchor } : {}),
      },
      prefs: this.prefs,
    });
  }

  private tearDown(): void {
    if (this.rendered) this.rendered.dispose();
    this.rendered = null;
    this.book = null;
    this.chapterIndex = 0;
    this.bookmarks = [];
    this.elements.bookmarksList.replaceChildren();
    this.elements.bookmarksTitle.hidden = true;
    this.elements.toc.replaceChildren();
    this.elements.title.textContent = '';
    this.elements.author.textContent = '';
    this.elements.chapterLabel.textContent = '';
    this.prefs = { ...DEFAULT_PREFS, ...loadGlobalPrefs() };
  }
}

function resolveAgainstPath(baseFile: string, href: string): string {
  // Inlined to avoid circular import; mirrors path.ts behavior.
  const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : '';
  const combined = baseDir ? `${baseDir}/${href}` : href;
  const stack: string[] = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}
