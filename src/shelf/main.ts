// reader-42 with no reader.
//
// The app is a shelf, a cross-book notebook, and an off-ramp to Logseq, over a
// folder KOReader owns. Opening a book hands off; there is no viewport in this
// build and no code path that could grow one. That absence is the argument:
// if the reading experience is solved elsewhere, this is what is left, and
// what is left is a product rather than a consolation.
//
// Everything is derived at load: no index file, no import, no state of our
// own. Delete this app and the library is exactly as KOReader left it.

import { readFace } from '../koreader/cover.ts';
import {
  type FolderAccess,
  type ShelfBook,
  allAnnotations,
  onDeck,
  readShelf,
  searchAnnotations,
} from '../koreader/library.ts';
import { logseqOutline } from './logseq.ts';

const LIB = '/lib';

/** The library folder over HTTP: a listing, and files. */
const folder: FolderAccess = {
  async list() {
    const response = await fetch(`${LIB}/`);
    if (!response.ok) return [];
    return (await response.json()) as string[];
  },
  async readText(path) {
    const response = await fetch(`${LIB}/${encodeURI(path)}`);
    return response.ok ? await response.text() : null;
  },
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const STATE_LABEL: Record<ShelfBook['state'], string> = {
  unread: 'Unread',
  reading: 'Reading',
  finished: 'Finished',
  dnf: 'Did not finish',
};

function percent(progress: number | null): string {
  return progress === null ? '' : `${Math.round(progress * 100)}%`;
}

/** A cover, or a typographic one generated from the book's own name — a book
 * that arrived without art still gets a face (vision.md: the beautiful shelf). */
function coverNode(book: ShelfBook, art: string | null): HTMLElement {
  const host = document.createElement('div');
  host.className = 'deck-cover';

  if (art) {
    const img = document.createElement('img');
    img.src = art;
    img.alt = '';
    host.appendChild(img);
  } else {
    const generated = document.createElement('div');
    generated.className = 'generated';
    const title = document.createElement('div');
    title.className = 'gt';
    title.textContent = book.title;
    const author = document.createElement('div');
    author.className = 'ga';
    author.textContent = book.author ?? '';
    generated.append(title, author);
    host.appendChild(generated);
  }

  if (book.progress !== null && book.progress > 0) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${Math.min(100, book.progress * 100)}%`;
    host.appendChild(bar);
  }
  return host;
}

/**
 * The handoff.
 *
 * The whole posture in one dialog: the shelf knows the book, and then hands it
 * to the thing that reads. It really launches — `POST /open` spawns KOReader
 * on that file — so this is the product's actual seam rather than a mock of
 * one. When there is no reader configured it says so and shows the command,
 * which is the honest degradation: a shelf with nowhere to send you should
 * admit it rather than pretend the tap did something.
 */
async function handoff(book: ShelfBook): Promise<void> {
  const dialog = el('handoff') as HTMLDialogElement;
  el('handoff-title').textContent = book.title;
  el('handoff-note').textContent = 'Opening in KOReader…';
  el('handoff-cmd').textContent = `koreader "${book.file}"`;
  dialog.showModal();

  try {
    const response = await fetch('/open', {
      method: 'POST',
      body: JSON.stringify({ file: book.file }),
    });
    const result = (await response.json()) as { ok: boolean; why?: string; launched?: string };
    el('handoff-note').textContent = result.ok
      ? `Reading in ${result.launched}. reader-42 does not open books.`
      : `No reader to hand off to (${result.why}). Run it yourself:`;
  } catch {
    el('handoff-note').textContent = 'Could not reach the shelf server. Run it yourself:';
  }
}

async function main(): Promise<void> {
  const books = await readShelf(folder);

  if (books.length === 0) {
    el('empty').hidden = false;
    return;
  }

  // Covers come out of the EPUBs themselves, in the browser, with the zip
  // reader this project already owns. No server, no cover cache, no import.
  const art = new Map<string, string>();
  await Promise.all(
    books.map(async (book) => {
      try {
        const response = await fetch(`${LIB}/${encodeURI(book.file)}`);
        if (!response.ok) return;
        const face = await readFace(new Uint8Array(await response.arrayBuffer()));
        if (face.metadata.title && book.author === null) {
          book.title = face.metadata.title;
          book.author = face.metadata.author;
        }
        if (face.cover) {
          const blob = new Blob([face.cover.bytes as BlobPart], { type: face.cover.mediaType });
          art.set(book.file, URL.createObjectURL(blob));
        }
      } catch {
        // A book whose cover will not load is still a book on the shelf.
      }
    }),
  );

  // --- on deck ---
  const deck = el('ondeck-list');
  for (const book of onDeck(books)) {
    const item = document.createElement('li');
    item.className = 'deck';
    item.appendChild(coverNode(book, art.get(book.file) ?? null));
    const meta = document.createElement('div');
    meta.className = 'deck-meta';
    const title = document.createElement('div');
    title.className = 't';
    title.textContent = book.title;
    const author = document.createElement('div');
    author.className = 'a';
    author.textContent = [book.author, percent(book.progress)].filter(Boolean).join(' · ');
    meta.append(title, author);
    item.appendChild(meta);
    item.onclick = (): void => void handoff(book);
    deck.appendChild(item);
  }

  // --- the collection ---
  const list = el('shelf-list');
  for (const book of books) {
    const row = document.createElement('li');

    const names = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = book.title;
    const author = document.createElement('div');
    author.className = 'row-author';
    author.textContent = book.author ?? '';
    names.append(title, author);

    const state = document.createElement('div');
    state.className = `state ${book.state}`;
    state.textContent = STATE_LABEL[book.state];

    const count = document.createElement('div');
    count.className = 'count';
    const marks = book.annotations.length;
    count.textContent = [percent(book.progress), marks > 0 ? `${marks} ✎` : '']
      .filter(Boolean)
      .join('  ');

    row.append(names, state, count);
    row.onclick = (): void => void handoff(book);
    list.appendChild(row);
  }

  // --- the notebook, across every book ---
  const rows = allAnnotations(books);
  const notebook = el('notebook-list');
  const countLine = el('search-count');

  const render = (query: string): void => {
    const shown = searchAnnotations(rows, query);
    notebook.replaceChildren();
    countLine.textContent = `${shown.length} of ${rows.length} highlights, ${
      new Set(shown.map((r) => r.book.file)).size
    } books`;
    for (const { book, annotation } of shown) {
      const item = document.createElement('li');
      const dot = document.createElement('div');
      dot.className = `dot ${annotation.color}`;
      const body = document.createElement('div');

      const text = document.createElement('div');
      text.className = 'hl-text';
      text.textContent = annotation.text;
      body.appendChild(text);

      if (annotation.note) {
        const note = document.createElement('div');
        note.className = 'hl-note';
        note.textContent = annotation.note;
        body.appendChild(note);
      }

      const where = document.createElement('div');
      where.className = 'hl-where';
      // KOReader's own chapter label: finer than a spine item, and the thing
      // the folder knows that an EPUB's spine alone does not.
      where.textContent = [book.title, annotation.chapter, annotation.createdAt.slice(0, 10)]
        .filter(Boolean)
        .join(' · ');
      body.appendChild(where);

      item.append(dot, body);
      notebook.appendChild(item);
    }
  };

  render('');
  el<HTMLInputElement>('search').oninput = (event): void =>
    render((event.target as HTMLInputElement).value);

  // --- out to Logseq, one outline per book, through the app's own exporter ---
  el('export').onclick = (): void => {
    const query = el<HTMLInputElement>('search').value;
    const shown = searchAnnotations(rows, query);
    const parts: string[] = [];
    for (const book of books) {
      const mine = shown.filter((row) => row.book.file === book.file);
      if (mine.length === 0) continue;
      parts.push(
        logseqOutline(
          book.title,
          mine.map(({ annotation }) => ({
            text: annotation.text,
            chapterTitle: annotation.chapter ?? 'Unknown chapter',
            // The link is into the library folder, not into a reader we do
            // not have: the file is the thing that persists.
            link: `file://${book.file}`,
            ...(annotation.note !== undefined ? { note: annotation.note } : {}),
          })),
        ),
      );
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'library-highlights.md';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  // --- views ---
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#views button'))) {
    button.onclick = (): void => {
      for (const other of Array.from(document.querySelectorAll('#views button'))) {
        other.classList.toggle('on', other === button);
      }
      const view = button.dataset.view;
      el('shelf-view').hidden = view !== 'shelf';
      el('notebook-view').hidden = view !== 'notebook';
    };
  }

  el('handoff-close').onclick = (): void => (el('handoff') as HTMLDialogElement).close();
}

await main();
