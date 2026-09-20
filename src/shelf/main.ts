// reader-42 with no reader.
//
// The app is a shelf, a cross-book notebook, an afterpage for a book you
// finished, and an off-ramp to Logseq — over a folder KOReader owns. Opening an
// unread book hands off; there is no viewport in this build and no code path to
// one. That absence is the argument.
//
// Everything is derived at load: no index file, no import, no state of our own.
// Delete this app and the library is exactly as KOReader left it.
//
// The design rule this file keeps learning the hard way: READ THE WHOLE FILE.
// The sidecar offers a rating, a review, a finish date, page numbers, colours
// and subject keywords. A shelf that lifts four fields and drops the rest
// behaves like a viewer of someone else's format instead of the owner of an
// experience — and the half of the thesis about rewarding having read lives
// entirely in the fields that are easiest to skip.

import { readFace } from '../koreader/cover.ts';
import {
  type FolderAccess,
  type ShelfBook,
  allAnnotations,
  onDeck,
  readShelf,
  searchAnnotations,
} from '../koreader/library.ts';
import type { KoAnnotation } from '../koreader/sdr.ts';
import { logseqOutline } from './logseq.ts';

const LIB = '/lib';

/** The library folder over HTTP: a listing, files, and how fresh they are. */
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
  async modifiedAt(path) {
    const response = await fetch(`${LIB}/${encodeURI(path)}`, { method: 'HEAD' });
    return response.ok ? response.headers.get('Last-Modified') : null;
  },
};

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const STATE_LABEL: Record<ShelfBook['state'], string> = {
  unread: 'Unread',
  reading: 'Reading',
  finished: 'Finished',
  dnf: 'Did not finish',
};

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/**
 * What to show beside a state.
 *
 * A finished book showing "55%" is two keys nobody reconciled, printed side by
 * side. Once a reader has said they are done, the percentage is not a second
 * opinion worth airing — and over a Gutenberg EPUB it is wrong anyway, because
 * the licence pages at the back mean the story ends around 68% of the file.
 */
function progressLabel(book: ShelfBook): string {
  if (book.state === 'finished' || book.progress === null) return '';
  return `${Math.round(book.progress * 100)}%`;
}

function stars(rating: number | undefined): string {
  if (!rating) return '';
  return '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));
}

/** A cover, or a typographic one generated from the book's own name. */
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

  if (book.state !== 'finished' && book.progress !== null && book.progress > 0) {
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
 * It really launches: POST /open spawns KOReader on the file. The copy matters
 * more than it looks — an earlier version announced "reader-42 does not open
 * books" over a shell command with a single Close button, which is a refusal
 * written in the grammar of an error, shown *after* the launch had already
 * succeeded. Someone reading that concludes it failed. So: say what is
 * happening, and then get out of the way.
 */
async function handoff(book: ShelfBook): Promise<void> {
  const dialog = el('handoff') as HTMLDialogElement;
  const cmd = el('handoff-cmd');
  el('handoff-title').textContent = book.title;
  el('handoff-note').textContent = 'Opening in KOReader…';
  cmd.textContent = `koreader "${book.file}"`;
  cmd.hidden = true;
  dialog.showModal();

  try {
    const response = await fetch('/open', {
      method: 'POST',
      body: JSON.stringify({ file: book.file }),
    });
    const result = (await response.json()) as { ok: boolean; why?: string };
    if (result.ok) {
      el('handoff-note').textContent = 'Reading in KOReader. Your place comes back here.';
      // A receipt nobody needs to dismiss: the action worked, so leave.
      setTimeout(() => dialog.close(), 1600);
      return;
    }
    el('handoff-note').textContent = 'No reader is set up yet. Open it yourself with:';
    cmd.hidden = false;
  } catch {
    el('handoff-note').textContent = 'Could not reach the library server. Open it yourself with:';
    cmd.hidden = false;
  }
}

/** Book title and chapter are often the same string in a one-chapter EPUB;
 * printing both is a stutter, not information. */
function placeOf(book: ShelfBook, annotation: KoAnnotation): string {
  const parts = [book.title];
  if (annotation.chapter && annotation.chapter !== book.title) parts.push(annotation.chapter);
  if (annotation.pageno !== undefined) parts.push(`p. ${annotation.pageno}`);
  parts.push(annotation.createdAt.slice(0, 10));
  return parts.join(' · ');
}

function showView(view: 'shelf' | 'notebook' | 'afterpage'): void {
  el('shelf-view').hidden = view !== 'shelf';
  el('notebook-view').hidden = view !== 'notebook';
  el('afterpage-view').hidden = view !== 'afterpage';
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#views button'))) {
    button.classList.toggle('on', button.dataset.view === view);
  }
}

// --- the afterpage --------------------------------------------------------

function renderAfterpage(book: ShelfBook): void {
  el('after-eyebrow').textContent = book.state === 'dnf' ? 'Put down' : 'Finished';
  el('after-title').textContent = book.title;
  el('after-byline').textContent = book.author ?? '';

  const starLine = el('after-stars');
  starLine.replaceChildren();
  if (book.rating) {
    const on = document.createElement('span');
    on.textContent = '★'.repeat(book.rating);
    const off = document.createElement('span');
    off.className = 'off';
    off.textContent = '☆'.repeat(Math.max(0, 5 - book.rating));
    starLine.append(on, off);
    starLine.hidden = false;
  } else {
    starLine.hidden = true;
  }

  const vitals = el('after-vitals');
  vitals.replaceChildren();
  const rows: [string, string][] = [];
  if (book.finishedAt) rows.push([book.state === 'dnf' ? 'Put down' : 'Finished', book.finishedAt]);
  rows.push(['Marked', plural(book.annotations.length, 'passage')]);
  const noted = book.annotations.filter((a) => a.note).length;
  if (noted > 0) rows.push(['With notes', String(noted)]);
  if (book.lastRead) rows.push(['Last touched', book.lastRead.slice(0, 10)]);
  for (const [term, value] of rows) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    wrap.append(dt, dd);
    vitals.appendChild(wrap);
  }

  const verdict = el('after-verdict');
  if (book.review) {
    el('after-review').textContent = book.review;
    verdict.hidden = false;
  } else {
    verdict.hidden = true;
  }

  const keywords = el('after-keywords');
  keywords.replaceChildren();
  for (const word of book.keywords.slice(0, 6)) {
    const item = document.createElement('li');
    item.textContent = word;
    keywords.appendChild(item);
  }

  const marks = el('after-marks');
  marks.replaceChildren();
  el('after-marks-head').hidden = book.annotations.length === 0;
  // "In sequence" means the book's order, not the order you happened to mark
  // things in — a reader who pages back to catch a passage they missed should
  // still see it where it belongs. Page number first, creation time only when
  // the device did not record one.
  for (const annotation of [...book.annotations].sort((a, b) => {
    if (a.pageno !== undefined && b.pageno !== undefined) return a.pageno - b.pageno;
    return a.createdAt.localeCompare(b.createdAt);
  })) {
    const item = document.createElement('li');
    const dot = document.createElement('div');
    dot.className = `dot ${annotation.color}`;
    const body = document.createElement('div');

    const text = document.createElement('div');
    text.className = 't';
    text.textContent = annotation.text;
    body.appendChild(text);

    if (annotation.note) {
      const note = document.createElement('div');
      note.className = 'n';
      note.textContent = annotation.note;
      body.appendChild(note);
    }

    const where = document.createElement('div');
    where.className = 'w';
    where.textContent = [
      annotation.pageno !== undefined ? `p. ${annotation.pageno}` : '',
      annotation.createdAt.slice(0, 10),
    ]
      .filter(Boolean)
      .join(' · ');
    body.appendChild(where);

    item.append(dot, body);
    marks.appendChild(item);
  }

  showView('afterpage');
}

// --- boot -----------------------------------------------------------------

async function main(): Promise<void> {
  const books = await readShelf(folder);

  if (books.length === 0) {
    el('empty').hidden = false;
    return;
  }

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

  const open = (book: ShelfBook): void => {
    if (book.state === 'finished' || book.state === 'dnf') renderAfterpage(book);
    else void handoff(book);
  };

  /** A cover tile. Finished books open their afterpage; the rest hand off. */
  const tile = (book: ShelfBook, subtitle: string): HTMLLIElement => {
    const item = document.createElement('li');
    item.appendChild(coverNode(book, art.get(book.file) ?? null));
    const meta = document.createElement('div');
    meta.className = 'deck-meta';
    const title = document.createElement('div');
    title.className = 't';
    title.textContent = book.title;
    const line = document.createElement('div');
    line.className = 'a';
    line.textContent = subtitle;
    meta.append(title, line);
    if (book.rating) {
      const rated = document.createElement('div');
      rated.className = 'r';
      rated.textContent = stars(book.rating);
      meta.appendChild(rated);
    }
    item.appendChild(meta);
    item.onclick = (): void => open(book);
    return item;
  };

  // --- on deck ---
  const deck = el('ondeck-list');
  const next = onDeck(books);
  for (const book of next) {
    deck.appendChild(tile(book, [book.author, progressLabel(book)].filter(Boolean).join(' · ')));
  }
  el('ondeck-empty').hidden = next.length > 0;

  // --- read: finishing a book must not make the shelf emptier ---
  const read = books.filter((b) => b.state === 'finished' || b.state === 'dnf');
  if (read.length > 0) {
    el('read').hidden = false;
    const readList = el('read-list');
    for (const book of read) {
      readList.appendChild(
        tile(book, [book.author, book.finishedAt ?? ''].filter(Boolean).join(' · ')),
      );
    }
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
    count.textContent = [progressLabel(book), marks > 0 ? `${marks} ✎` : '']
      .filter(Boolean)
      .join('  ');

    row.append(names, state, count);
    row.onclick = (): void => open(book);
    list.appendChild(row);
  }

  // --- how fresh any of this is ---
  // KOReader flushes its sidecar on exit. Until then the folder is behind, and
  // a library that cannot say "as of" is lying rather than merely late.
  const newest = books
    .map((b) => b.sidecarModifiedAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(-1);
  el('freshness').textContent = newest
    ? `As the folder stood at ${new Date(newest).toLocaleTimeString()}. KOReader writes when it closes.`
    : 'Nothing read yet.';

  // --- the notebook, across every book ---
  const rows = allAnnotations(books);
  const notebook = el('notebook-list');
  const countLine = el('search-count');
  const emptyLine = el('notebook-empty');
  let shown = rows;

  const render = (query: string): void => {
    shown = searchAnnotations(rows, query);
    notebook.replaceChildren();
    countLine.textContent = `${shown.length} of ${plural(rows.length, 'highlight')}, ${plural(
      new Set(shown.map((r) => r.book.file)).size,
      'book',
    )}`;

    if (shown.length === 0) {
      emptyLine.hidden = false;
      // Say what was actually searched. The old placeholder promised recall
      // across the text of the books, which this does not have.
      emptyLine.textContent = query.trim()
        ? `Nothing marked matches “${query.trim()}”. Only highlights and notes are searched, not the text of the books.`
        : 'Nothing highlighted yet.';
      return;
    }
    emptyLine.hidden = true;

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
      where.textContent = placeOf(book, annotation);
      body.appendChild(where);

      item.append(dot, body);
      notebook.appendChild(item);
    }
  };

  render('');
  el<HTMLInputElement>('search').oninput = (event): void =>
    render((event.target as HTMLInputElement).value);

  // --- out to Logseq ---
  el('export').onclick = (): void => {
    // Exporting what is on screen is the honest behaviour, but writing an
    // empty file under the usual name is how someone's real export gets
    // overwritten by nothing and they find out weeks later.
    if (shown.length === 0) {
      emptyLine.hidden = false;
      emptyLine.textContent = 'Nothing to export. Clear the search first.';
      return;
    }
    const filtered = shown.length !== rows.length;
    const parts: string[] = [];
    for (const book of books) {
      const mine = shown.filter((row) => row.book.file === book.file);
      if (mine.length === 0) continue;
      parts.push(
        logseqOutline(
          book.title,
          mine.map(({ annotation }) => {
            const chapter =
              annotation.chapter && annotation.chapter !== book.title ? annotation.chapter : '';
            const page = annotation.pageno !== undefined ? `page ${annotation.pageno}` : '';
            return {
              text: annotation.text,
              chapterTitle: [chapter, page].filter(Boolean).join(', ') || 'Unplaced',
              // An absolute, encoded file URL. The old one was the bare
              // filename with raw spaces, so "The Yellow Wallpaper.epub"
              // parsed as a host called "The" and resolved to nothing.
              link: new URL(`${LIB}/${encodeURI(book.file)}`, location.href).href,
              ...(annotation.note !== undefined ? { note: annotation.note } : {}),
            };
          }),
        ),
      );
    }
    const blob = new Blob([parts.join('\n')], { type: 'text/markdown' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    // A filtered export is a different document and gets a different name.
    anchor.download = filtered ? 'library-highlights-filtered.md' : 'library-highlights.md';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  // --- views ---
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('#views button'))) {
    button.onclick = (): void =>
      showView(button.dataset.view === 'notebook' ? 'notebook' : 'shelf');
  }
  el('after-back').onclick = (): void => showView('shelf');
  el('handoff-close').onclick = (): void => (el('handoff') as HTMLDialogElement).close();
}

await main();
