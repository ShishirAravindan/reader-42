// Boot the app: library shelf (import, state, open) + reader.
//
// The library talks to the server API (/library, /reader/:id/epub); the
// reader itself stays server-agnostic — it just receives EPUB bytes.

import { loadEpub } from './epub/index.ts';
import { type OpenTarget, type ReaderElements, ReaderUI } from './reader/ui.ts';

type ItemState = 'unread' | 'reading' | 'finished' | 'dnf';

interface LibraryItem {
  id: string;
  title: string | null;
  author: string | null;
  state: ItemState;
  progress: number;
  totalSeconds: number;
  importedAt: string | number;
  updatedAt: string | number;
}

interface SearchResult {
  item: LibraryItem;
  matches: { chapter: number; chapterTitle: string | null; snippet: string }[];
}

const STATE_LABELS: Record<ItemState, string> = {
  unread: 'Unread',
  reading: 'Reading',
  finished: 'Finished',
  dnf: 'Did not finish',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function readerElements(): ReaderElements {
  return {
    root: el('app'),
    toc: el('toc'),
    viewport: el('viewport'),
    title: el('book-title'),
    author: el('book-author'),
    prevBtn: el<HTMLButtonElement>('btn-prev'),
    nextBtn: el<HTMLButtonElement>('btn-next'),
    fontButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-size]')),
    themeButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>('.control-btn[data-theme]'),
    ),
    modeButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>('.control-btn[data-mode]'),
    ),
    measureButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-measure]')),
    leadingButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-leading]')),
    typoToggle: el<HTMLButtonElement>('btn-typo'),
    typoPanel: el('typo-panel'),
    tocToggle: el<HTMLButtonElement>('btn-toc'),
    chapterLabel: el('chapter-label'),
    bookmarkBtn: el<HTMLButtonElement>('btn-bookmark'),
    bookmarksTitle: el('bookmarks-title'),
    bookmarksList: el('bookmarks'),
    findInput: el<HTMLInputElement>('find-input'),
    findResults: el('find-results'),
  };
}

class LibraryApp {
  private readonly ui: ReaderUI;
  private readonly libraryView = el('library-view');
  private readonly readerView = el('reader-view');
  private readonly list = el<HTMLUListElement>('lib-list');
  private readonly count = el('lib-count');
  private readonly empty = el('lib-empty');
  private readonly status = el('status');
  private readonly dropVeil = el('drop-veil');
  private dragDepth = 0;
  private currentItem: LibraryItem | null = null;
  private sessionStartedAt = 0;
  private latestProgress: number | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.ui = new ReaderUI(readerElements(), {
      onProgress: (fraction) => {
        this.latestProgress = fraction;
      },
    });
    // Small screens start with the TOC tucked away; the ☰ button reveals it.
    if (window.matchMedia('(max-width: 700px)').matches) {
      el('app').classList.add('toc-collapsed');
    }
    this.bind();
    void this.refresh();
  }

  private bind(): void {
    const fileInput = el<HTMLInputElement>('file-input');
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files ?? []);
      fileInput.value = '';
      for (const file of files) await this.importFile(file);
    });

    el<HTMLButtonElement>('btn-library').addEventListener('click', () => {
      this.showLibrary();
    });

    // Drag-drop import, only while the library is visible.
    document.addEventListener('dragenter', (event) => {
      if (this.libraryView.hidden) return;
      event.preventDefault();
      this.dragDepth += 1;
      this.dropVeil.hidden = false;
    });
    document.addEventListener('dragover', (event) => {
      if (this.libraryView.hidden) return;
      event.preventDefault();
    });
    document.addEventListener('dragleave', () => {
      if (this.libraryView.hidden) return;
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dropVeil.hidden = true;
    });
    document.addEventListener('drop', async (event) => {
      if (this.libraryView.hidden) return;
      event.preventDefault();
      this.dragDepth = 0;
      this.dropVeil.hidden = true;
      const files = Array.from(event.dataTransfer?.files ?? []);
      for (const file of files) await this.importFile(file);
    });

    // Library search (title/author/full text via FTS).
    const searchInput = el<HTMLInputElement>('lib-search');
    let searchTimer: ReturnType<typeof setTimeout> | null = null;
    searchInput.addEventListener('input', () => {
      if (searchTimer !== null) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchTimer = null;
        void this.runSearch(searchInput.value.trim());
      }, 300);
    });

    // Flush the reading session + progress when the tab goes away.
    window.addEventListener('pagehide', () => this.endReadingSession(true));
  }

  private async runSearch(q: string): Promise<void> {
    if (q.length < 2) {
      await this.refresh();
      return;
    }
    try {
      const res = await fetch(`/library/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { results } = (await res.json()) as { results: SearchResult[] };
      this.renderSearch(q, results);
    } catch (err) {
      this.say(`Search failed: ${(err as Error).message}`);
    }
  }

  private renderSearch(q: string, results: SearchResult[]): void {
    this.count.textContent =
      results.length === 0
        ? `no matches for “${q}”`
        : `${results.length} ${results.length === 1 ? 'book matches' : 'books match'} “${q}”`;
    this.empty.hidden = true;
    this.list.replaceChildren(
      ...results.map((result) => {
        const li = this.card(result.item);
        const matches = document.createElement('ol');
        matches.className = 'lib-matches';
        for (const match of result.matches.slice(0, 5)) {
          const entry = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'lib-match';
          const where = document.createElement('span');
          where.className = 'lib-match-where';
          where.textContent = match.chapterTitle ?? `Chapter ${match.chapter + 1}`;
          const snippet = document.createElement('span');
          snippet.className = 'lib-match-snippet';
          // The server wraps hits in « » — render them as real marks.
          for (const part of match.snippet.split(/«([^»]*)»/)) {
            const index = snippet.childNodes.length;
            if (index % 2 === 1) {
              snippet.appendChild(
                Object.assign(document.createElement('mark'), { textContent: part }),
              );
            } else {
              snippet.appendChild(document.createTextNode(part));
            }
          }
          btn.append(where, snippet);
          btn.addEventListener(
            'click',
            () => void this.open(result.item, { chapter: match.chapter, find: q }),
          );
          entry.appendChild(btn);
          matches.appendChild(entry);
        }
        li.appendChild(matches);
        return li;
      }),
    );
  }

  // --- reading sessions + progress reporting ---

  private beginReadingSession(item: LibraryItem): void {
    this.currentItem = item;
    this.sessionStartedAt = Date.now();
    this.latestProgress = null;
    if (this.progressTimer !== null) clearInterval(this.progressTimer);
    this.progressTimer = setInterval(() => void this.flushProgress(), 20000);
  }

  private async flushProgress(): Promise<void> {
    if (!this.currentItem || this.latestProgress === null) return;
    const progress = this.latestProgress;
    this.latestProgress = null;
    await fetch(`/library/${this.currentItem.id}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress }),
      keepalive: true,
    }).catch(() => {});
  }

  private endReadingSession(unloading = false): void {
    if (!this.currentItem) return;
    const seconds = Math.round((Date.now() - this.sessionStartedAt) / 1000);
    if (this.progressTimer !== null) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    void this.flushProgress();
    if (seconds >= 5) {
      const url = `/library/${this.currentItem.id}/session`;
      const body = JSON.stringify({ seconds });
      if (unloading && navigator.sendBeacon) {
        navigator.sendBeacon(`${url}?beacon=1`, new Blob([body], { type: 'application/json' }));
      } else {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    }
    this.currentItem = null;
  }

  private say(message: string): void {
    this.status.textContent = message;
    if (message) {
      setTimeout(() => {
        if (this.status.textContent === message) this.status.textContent = '';
      }, 4000);
    }
  }

  private async refresh(): Promise<void> {
    try {
      const res = await fetch('/library');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: LibraryItem[] };
      this.render(data.items);
    } catch (err) {
      this.say(`Could not load the library: ${(err as Error).message}`);
    }
  }

  private render(items: LibraryItem[]): void {
    this.count.textContent =
      items.length === 0 ? '' : `${items.length} ${items.length === 1 ? 'book' : 'books'}`;
    this.empty.hidden = items.length > 0;
    this.list.replaceChildren(...items.map((item) => this.card(item)));
  }

  private card(item: LibraryItem): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'lib-card';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'lib-open';
    const title = document.createElement('span');
    title.className = 'lib-book-title';
    title.textContent = item.title ?? 'Untitled';
    const author = document.createElement('span');
    author.className = 'lib-book-author';
    author.textContent = item.author ?? '';
    open.append(title, author);
    open.addEventListener('click', () => void this.open(item));

    const meta = document.createElement('div');
    meta.className = 'lib-meta';
    if (item.progress > 0 || item.totalSeconds > 0) {
      const stats = document.createElement('span');
      stats.className = 'lib-stats';
      const parts: string[] = [];
      if (item.progress > 0) parts.push(`${Math.round(item.progress * 100)}%`);
      if (item.totalSeconds > 0) parts.push(formatDuration(item.totalSeconds));
      stats.textContent = parts.join(' · ');
      meta.appendChild(stats);
    }
    const imported = document.createElement('span');
    imported.className = 'lib-date';
    imported.textContent = formatDate(item.importedAt);
    const state = document.createElement('select');
    state.className = 'lib-state';
    state.setAttribute('aria-label', 'Reading state');
    for (const value of Object.keys(STATE_LABELS) as ItemState[]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = STATE_LABELS[value];
      option.selected = value === item.state;
      state.appendChild(option);
    }
    state.dataset.state = item.state;
    state.addEventListener('change', async () => {
      const updated = await this.setState(item.id, state.value as ItemState);
      if (updated) state.dataset.state = state.value;
      else state.value = item.state;
    });
    meta.append(imported, state);

    li.append(open, meta);
    return li;
  }

  private async setState(id: string, state: ItemState): Promise<boolean> {
    try {
      const res = await fetch(`/library/${id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (err) {
      this.say(`Could not update state: ${(err as Error).message}`);
      return false;
    }
  }

  private async importFile(file: File): Promise<void> {
    this.say(`Importing ${file.name}…`);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/library/import', { method: 'POST', body });
      const data = (await res.json()) as { item?: LibraryItem; error?: string };
      if (!res.ok || !data.item) throw new Error(data.error ?? `HTTP ${res.status}`);
      this.say(`Imported “${data.item.title ?? file.name}”.`);
      await this.refresh();
    } catch (err) {
      this.say(`Import failed: ${(err as Error).message}`);
    }
  }

  private async open(item: LibraryItem, target?: OpenTarget): Promise<void> {
    this.say(`Opening “${item.title ?? 'Untitled'}”…`);
    try {
      const res = await fetch(`/reader/${item.id}/epub`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const book = await loadEpub(await res.arrayBuffer());
      // Show the reader before opening: position restore measures the layout,
      // and a display:none viewport has no geometry to measure.
      this.showReader();
      try {
        this.ui.open(book, target);
      } catch (err) {
        this.showLibrary();
        throw err;
      }
      this.say('');
      this.beginReadingSession(item);
      // Opening an unread book moves it to reading — the shelf is a record.
      if (item.state === 'unread') void this.setState(item.id, 'reading');
    } catch (err) {
      this.say(`Could not open the book: ${(err as Error).message}`);
    }
  }

  private showReader(): void {
    this.libraryView.hidden = true;
    this.readerView.hidden = false;
  }

  private showLibrary(): void {
    this.endReadingSession();
    this.readerView.hidden = true;
    this.libraryView.hidden = false;
    void this.refresh();
  }
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} m`;
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

new LibraryApp();
