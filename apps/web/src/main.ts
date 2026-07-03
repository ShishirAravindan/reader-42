// Boot the app: library shelf (import, state, open) + reader.
//
// The library talks to the server API (/library, /reader/:id/epub); the
// reader itself stays server-agnostic — it just receives EPUB bytes.

import { loadEpub } from './epub/index.ts';
import { type ReaderElements, ReaderUI } from './reader/ui.ts';

type ItemState = 'unread' | 'reading' | 'finished' | 'dnf';

interface LibraryItem {
  id: string;
  title: string | null;
  author: string | null;
  state: ItemState;
  importedAt: string | number;
  updatedAt: string | number;
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
    tocToggle: el<HTMLButtonElement>('btn-toc'),
    chapterLabel: el('chapter-label'),
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

  constructor() {
    this.ui = new ReaderUI(readerElements());
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

  private async open(item: LibraryItem): Promise<void> {
    this.say(`Opening “${item.title ?? 'Untitled'}”…`);
    try {
      const res = await fetch(`/reader/${item.id}/epub`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const book = await loadEpub(await res.arrayBuffer());
      // Show the reader before opening: position restore measures the layout,
      // and a display:none viewport has no geometry to measure.
      this.showReader();
      try {
        this.ui.open(book);
      } catch (err) {
        this.showLibrary();
        throw err;
      }
      this.say('');
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
    this.readerView.hidden = true;
    this.libraryView.hidden = false;
    void this.refresh();
  }
}

function formatDate(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

new LibraryApp();
