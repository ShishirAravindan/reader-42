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
import { applyOptions, renderChapter, type RenderedChapter } from './renderer.ts';
import {
  DEFAULT_PREFS,
  loadBookState,
  loadGlobalPrefs,
  saveBookState,
  saveGlobalPrefs,
  type ReaderPrefs,
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
  tocToggle: HTMLButtonElement;
  chapterLabel: HTMLElement;
}

const FONT_SCALES: Record<'s' | 'm' | 'l', number> = { s: 0.9, m: 1, l: 1.15 };

export class ReaderUI {
  private readonly elements: ReaderElements;
  private book: Book | null = null;
  private rendered: RenderedChapter | null = null;
  private chapterIndex = 0;
  private prefs: ReaderPrefs;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.refreshControlState();

    const safeIndex = Math.min(Math.max(startChapter, 0), book.chapters.length - 1);
    this.goToChapter(safeIndex, { scroll: startScroll });
  }

  private bindControls(): void {
    const { prevBtn, nextBtn, fontButtons, themeButtons, tocToggle, viewport } = this.elements;

    prevBtn.addEventListener('click', () => this.goPrev());
    nextBtn.addEventListener('click', () => this.goNext());

    for (const btn of fontButtons) {
      btn.addEventListener('click', () => {
        const size = btn.dataset.size as 's' | 'm' | 'l' | undefined;
        if (!size) return;
        this.prefs = { ...this.prefs, fontScale: FONT_SCALES[size] };
        this.applyPrefs();
        this.persist();
      });
    }
    for (const btn of themeButtons) {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.theme as ReaderPrefs['theme'] | undefined;
        if (!theme) return;
        this.prefs = { ...this.prefs, theme };
        this.applyPrefs();
        this.persist();
      });
    }
    tocToggle.addEventListener('click', () => {
      this.elements.root.classList.toggle('toc-collapsed');
    });

    viewport.addEventListener('scroll', () => this.schedulePersist(), { passive: true });
    viewport.addEventListener('click', (event) => this.onViewportClick(event));

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
    if (!anchor) return;
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
    if (this.chapterIndex <= 0) return;
    this.goToChapter(this.chapterIndex - 1);
  }

  private goNext(): void {
    if (!this.book) return;
    if (this.chapterIndex >= this.book.chapters.length - 1) return;
    this.goToChapter(this.chapterIndex + 1);
  }

  private goToChapter(
    index: number,
    opts: { scroll?: number; fragment?: string | null } = {},
  ): void {
    if (!this.book) return;
    const chapter = this.book.chapters[index];
    if (!chapter) return;
    if (this.rendered) this.rendered.dispose();
    this.chapterIndex = index;
    this.rendered = renderChapter(this.book, chapter, this.elements.viewport, {
      fontScale: this.prefs.fontScale,
      theme: this.prefs.theme,
    });
    this.elements.viewport.scrollTop = opts.scroll ?? 0;
    if (opts.fragment) {
      // Fragment scrolling needs to happen after the browser positions the
      // shadow DOM content; a microtask is sufficient.
      queueMicrotask(() => this.rendered?.scrollToFragment(opts.fragment ?? ''));
    }
    this.elements.chapterLabel.textContent = chapter.title
      ? `${index + 1} of ${this.book.chapters.length}: ${chapter.title}`
      : `${index + 1} of ${this.book.chapters.length}`;
    this.refreshControlState();
    this.highlightTocFor(chapter);
    this.persist();
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
      btn.classList.toggle('is-active', size !== undefined && FONT_SCALES[size] === this.prefs.fontScale);
    }
    for (const btn of this.elements.themeButtons) {
      btn.classList.toggle('is-active', btn.dataset.theme === this.prefs.theme);
    }
    this.elements.root.dataset.theme = this.prefs.theme;
  }

  private applyPrefs(): void {
    if (this.rendered) {
      applyOptions(this.rendered.host, {
        fontScale: this.prefs.fontScale,
        theme: this.prefs.theme,
      });
    }
    saveGlobalPrefs(this.prefs);
    this.refreshControlState();
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
    saveBookState(this.book.id, {
      position: {
        chapter: this.chapterIndex,
        scroll: this.rendered.getScroll(),
      },
      prefs: this.prefs,
    });
  }

  private tearDown(): void {
    if (this.rendered) this.rendered.dispose();
    this.rendered = null;
    this.book = null;
    this.chapterIndex = 0;
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
