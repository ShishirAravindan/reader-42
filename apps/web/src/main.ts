// Boot the reader UI. Wires DOM lookups + file-input handling and exposes
// a single auto-load button that fetches the bundled fixture.

import { loadEpub } from './epub/index.ts';
import { ReaderUI, type ReaderElements } from './reader/ui.ts';

const FIXTURE_URL = '/fixtures/test-book.epub';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function elements(): ReaderElements {
  return {
    root: el('app'),
    toc: el('toc'),
    viewport: el('viewport'),
    title: el('book-title'),
    author: el('book-author'),
    prevBtn: el<HTMLButtonElement>('btn-prev'),
    nextBtn: el<HTMLButtonElement>('btn-next'),
    fontButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-size]')),
    themeButtons: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-theme]')),
    tocToggle: el<HTMLButtonElement>('btn-toc'),
    chapterLabel: el('chapter-label'),
  };
}

async function main(): Promise<void> {
  const ui = new ReaderUI(elements());
  const status = el('status');

  const fileInput = el<HTMLInputElement>('file-input');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = `Loading ${file.name}…`;
    try {
      const book = await loadEpub(file);
      ui.open(book);
      status.textContent = '';
    } catch (err) {
      status.textContent = `Failed to load EPUB: ${(err as Error).message}`;
    }
  });

  el<HTMLButtonElement>('btn-fixture').addEventListener('click', async () => {
    status.textContent = 'Loading test fixture…';
    try {
      const res = await fetch(FIXTURE_URL);
      if (!res.ok) throw new Error(`fixture HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const book = await loadEpub(buf);
      ui.open(book);
      status.textContent = '';
    } catch (err) {
      status.textContent = `Could not load fixture: ${(err as Error).message}`;
    }
  });
}

void main();
