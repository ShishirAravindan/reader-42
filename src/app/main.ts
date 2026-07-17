// App shell: transport selection, the shelf, and the reader wiring.
//
// Routing is the URL hash ('' = shelf, '#/book/<id>' = reader) so browser
// Back always returns to the shelf. Chrome here is deliberately plain; the
// aesthetic pass is its own milestone.

import { Book, readMetadata } from '../epub/book.ts';
import type { TocEntry } from '../epub/types.ts';
import { BrowserDeviceStore } from '../library/browser-store.ts';
import { DeviceCacheTransport } from '../library/device-cache.ts';
import { Library } from '../library/store.ts';
import type { LibraryTransport } from '../library/transport.ts';
import { DevHttpTransport } from '../library/transports/dev-http.ts';
import { LocalFolderTransport } from '../library/transports/local-folder.ts';
import type { BookSidecar } from '../library/types.ts';
import { ReaderController } from '../reader/controller.ts';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}

const sections = {
  welcome: el<HTMLElement>('welcome'),
  shelf: el<HTMLElement>('shelf'),
  reader: el<HTMLElement>('reader'),
};

function show(name: keyof typeof sections): void {
  for (const [key, section] of Object.entries(sections)) {
    section.hidden = key !== name;
  }
}

let library: Library | null = null;
let deviceCache: DeviceCacheTransport | null = null;
let controller: ReaderController | null = null;
let openSidecar: BookSidecar | null = null;

// --- boot: pick a transport ---

async function boot(): Promise<void> {
  // The shell lives in the service worker cache after first visit, so the
  // app cold-opens with no network (see web/sw.js).
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // No worker (http, old browser): the app still runs, just not offline.
    });
  }
  const params = new URLSearchParams(location.search);
  if (params.get('lib') === 'dev') {
    // Remote transports get the on-device cache: the current book and the
    // on-deck queue stay fully local, so reading never needs the network.
    deviceCache = new DeviceCacheTransport(new DevHttpTransport(), new BrowserDeviceStore());
    await openLibrary(deviceCache);
    void deviceCache.syncCachePolicy();
    return;
  }
  show('welcome');
  el<HTMLButtonElement>('open-library').addEventListener('click', async () => {
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (opts: { mode: string }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      alert('This browser cannot open local folders; use Chrome/Edge for now.');
      return;
    }
    try {
      const root = await picker({ mode: 'readwrite' });
      await openLibrary(new LocalFolderTransport(root));
    } catch {
      // Picker dismissed.
    }
  });
}

async function openLibrary(transport: LibraryTransport): Promise<void> {
  library = await Library.open(transport);
  window.addEventListener('hashchange', route);
  route();
}

// --- routing ---

function route(): void {
  const match = location.hash.match(/^#\/book\/([0-9a-f]+)/);
  if (match?.[1] && library) {
    void openBook(match[1]);
  } else {
    closeReader();
    renderShelf();
  }
}

// --- shelf ---

async function renderShelf(): Promise<void> {
  if (!library) return;
  show('shelf');
  const list = el<HTMLUListElement>('book-list');
  list.replaceChildren();

  const entries = library.index().books;
  el<HTMLElement>('shelf-empty').hidden = entries.length > 0;

  for (const entry of entries) {
    const sidecar = await library.readSidecar(entry.id);
    const li = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'book-title';
    title.textContent = sidecar?.title ?? entry.title;
    const meta = document.createElement('span');
    meta.className = 'book-meta';
    meta.textContent = shelfMeta(sidecar);
    li.append(title, meta);
    li.addEventListener('click', () => {
      location.hash = `#/book/${entry.id}`;
    });
    list.appendChild(li);
  }

  const input = el<HTMLInputElement>('import-input');
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !library) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const meta = await readMetadata(bytes);
      const result = await library.importBook(bytes, {
        title: meta.title,
        author: meta.author,
      });
      if (result.duplicate) alert(`Already on your shelf: ${result.sidecar.title}`);
      await renderShelf();
    } catch (err) {
      alert(`Could not import: ${err instanceof Error ? err.message : 'not a valid EPUB'}`);
    }
  };
}

function shelfMeta(sidecar: BookSidecar | null): string {
  if (!sidecar) return '';
  const bits: string[] = [];
  if (sidecar.author) bits.push(sidecar.author);
  if (sidecar.state === 'reading') bits.push(`${Math.round(sidecar.progress * 100)}%`);
  else if (sidecar.state !== 'unread') bits.push(sidecar.state);
  return bits.join(' · ');
}

// --- reader ---

async function openBook(id: string): Promise<void> {
  if (!library) return;
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

  show('reader');
  el<HTMLElement>('reader-book-title').textContent = sidecar.title;

  const viewport = el<HTMLElement>('viewport');
  controller = new ReaderController(book, viewport, {
    onChapter: (index) => {
      el<HTMLElement>('reader-chapter-label').textContent =
        `${index + 1} of ${book.chapters.length}`;
    },
    onPosition: ({ position, progress }) => {
      if (!library || !openSidecar) return;
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
  });
  controller.open(sidecar.position);
  el<HTMLElement>('progress-label').textContent = `${Math.round(sidecar.progress * 100)}%`;

  el<HTMLButtonElement>('back-to-shelf').onclick = () => {
    location.hash = '';
  };
  el<HTMLButtonElement>('prev-chapter').onclick = () => controller?.prevChapter();
  el<HTMLButtonElement>('next-chapter').onclick = () => controller?.nextChapter();

  const toc = el<HTMLElement>('toc');
  renderToc(toc, book.toc);
  el<HTMLButtonElement>('toc-toggle').onclick = () => {
    toc.hidden = !toc.hidden;
  };

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

function closeReader(): void {
  controller?.dispose();
  controller = null;
  openSidecar = null;
}

void boot();
