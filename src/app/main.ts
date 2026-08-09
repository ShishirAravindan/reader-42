// App shell: transport selection, routing, and the shelf.
//
// Routing is the URL hash ('' = shelf, '#/book/<id>' = reader,
// '#/book/<id>/hl/<hid>' = reader at a highlight) so browser Back always
// returns to the shelf. The reader's own wiring lives in
// reader-shell.ts; chrome here is deliberately plain.

import { readMetadata } from '../epub/book.ts';
import { BrowserDeviceStore } from '../library/browser-store.ts';
import { DeviceCacheTransport } from '../library/device-cache.ts';
import { Library } from '../library/store.ts';
import type { LibraryTransport } from '../library/transport.ts';
import { DevHttpTransport } from '../library/transports/dev-http.ts';
import { OAuthTokenProvider, captureDriveToken } from '../library/transports/drive-auth.ts';
import { DriveTransport } from '../library/transports/drive.ts';
import { LocalFolderTransport } from '../library/transports/local-folder.ts';
import { el } from './dom.ts';
import { getTheme } from './prefs.ts';
import { closeReader, openReader } from './reader-shell.ts';
import { loadShelfRows } from './shelf.ts';
import { applyTheme } from './theme.ts';

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

// --- install flow ---

// Chromium surfaces installability via beforeinstallprompt; stash it and
// show a quiet Install button on the shelf. Safari has no such event — its
// path is Share → Add to Home Screen — so there the button never appears.
let installPrompt: { prompt: () => Promise<unknown> } | null = null;

function wireInstallFlow(): void {
  const button = el<HTMLButtonElement>('install-app');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as unknown as { prompt: () => Promise<unknown> };
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
  });
  button.onclick = async () => {
    await installPrompt?.prompt();
    installPrompt = null;
    button.hidden = true;
  };
}

// --- boot: pick a transport ---

async function boot(): Promise<void> {
  // The theme is app-wide, not reader-only: the shelf wears it too.
  applyTheme(getTheme());
  // The shell lives in the service worker cache after first visit, so the
  // app cold-opens with no network (see web/sw.js).
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // No worker (http, old browser): the app still runs, just not offline.
    });
  }
  // If this load is the return leg of a Drive OAuth redirect, the token is
  // in the fragment; capture it before the router can misread it.
  captureDriveToken();
  wireInstallFlow();
  const params = new URLSearchParams(location.search);
  if (params.get('lib') === 'dev') {
    await openRemoteLibrary(new DevHttpTransport());
    return;
  }
  if (params.get('lib') === 'drive') {
    let clientId = localStorage.getItem('drive-client-id');
    if (!clientId) {
      clientId = prompt('Google OAuth client id (see docs/drive-setup.md):')?.trim() ?? '';
      if (!clientId) {
        show('welcome');
        return;
      }
      localStorage.setItem('drive-client-id', clientId);
    }
    await openRemoteLibrary(
      new DriveTransport({ tokenProvider: new OAuthTokenProvider(clientId) }),
    );
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

/**
 * Remote transports get the on-device cache: the current book and the
 * on-deck queue stay fully local, so reading never needs the network, and
 * queued offline writes flush when the connection returns (and at boot,
 * inside syncCachePolicy).
 */
async function openRemoteLibrary(remote: LibraryTransport): Promise<void> {
  deviceCache = new DeviceCacheTransport(remote, new BrowserDeviceStore());
  window.addEventListener('online', () => void deviceCache?.flush());
  await openLibrary(deviceCache);
  void deviceCache.syncCachePolicy();
}

// --- routing ---

function route(): void {
  // '#/book/<id>' opens the book; '#/book/<id>/hl/<hid>' is a highlight deep
  // link (F5) — same book, landing on that highlight. The hash is never
  // rewritten, so the address bar stays copyable.
  const match = location.hash.match(/^#\/book\/([0-9a-f]+)(?:\/hl\/([0-9a-f]+))?/);
  if (match?.[1] && library) {
    void openReader(
      { library, deviceCache, showReader: () => show('reader') },
      match[1],
      match[2] ?? null,
    );
  } else {
    closeReader();
    renderShelf();
  }
}

// --- shelf ---

// Guards against overlapping renders: renderShelf runs on every hashchange
// back to the shelf, and a slow remote fetch from a prior call must never
// clobber a faster, more recent one's rows or clear its loading state out
// from under it (mirrors the showToken idiom in dictionary-card.ts).
let shelfToken = 0;

async function renderShelf(): Promise<void> {
  if (!library) return;
  const lib = library;
  const token = ++shelfToken;
  show('shelf');
  const list = el<HTMLUListElement>('book-list');
  list.replaceChildren();
  delete list.dataset.state;

  const entries = lib.index().books;
  el<HTMLElement>('shelf-empty').hidden = entries.length > 0;

  // Wired before the fetch resolves so Import stays usable while the shelf
  // is still loading.
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

  if (entries.length === 0) return;

  list.dataset.state = 'loading';
  try {
    const rows = await loadShelfRows(entries, (id) => lib.readSidecar(id));
    if (token !== shelfToken) return; // superseded by a later renderShelf
    for (const row of rows) {
      const li = document.createElement('li');
      const title = document.createElement('span');
      title.className = 'book-title';
      title.textContent = row.title;
      const meta = document.createElement('span');
      meta.className = 'book-meta';
      meta.textContent = row.meta;
      li.append(title, meta);
      li.addEventListener('click', () => {
        location.hash = `#/book/${row.id}`;
      });
      list.appendChild(li);
    }
  } finally {
    if (token === shelfToken) delete list.dataset.state;
  }
}

void boot();
