import { describe, expect, test } from 'bun:test';
import {
  type FolderAccess,
  allAnnotations,
  onDeck,
  readShelf,
  searchAnnotations,
  shelfState,
  sidecarPathFor,
  titleFromFile,
} from './library.ts';

/** A KOReader folder in memory. */
function folderOf(files: Record<string, string>): FolderAccess {
  return {
    async list() {
      // A real listing is flat and includes the .sdr directories.
      return Object.keys(files);
    },
    async readText(path) {
      return files[path] ?? null;
    },
  };
}

function sidecar(opts: {
  title?: string;
  author?: string;
  status?: string;
  percent?: number;
  annotations?: { text: string; note?: string; chapter?: string; datetime?: string }[];
}): string {
  const annotations = (opts.annotations ?? [])
    .map((a, i) =>
      [
        `        [${i + 1}] = {`,
        a.chapter ? `            ["chapter"] = "${a.chapter}",` : '',
        `            ["datetime"] = "${a.datetime ?? '2026-09-12 21:04:11'}",`,
        a.note ? `            ["note"] = "${a.note}",` : '',
        `            ["pos0"] = "/body/DocFragment[2]/body/p[1]/text().0",`,
        `            ["text"] = "${a.text}",`,
        '        },',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');
  return [
    'return {',
    '    ["annotations"] = {',
    annotations,
    '    },',
    '    ["doc_props"] = {',
    `        ["authors"] = "${opts.author ?? 'A. Author'}",`,
    `        ["title"] = "${opts.title ?? 'A Book'}",`,
    '    },',
    `    ["percent_finished"] = ${opts.percent ?? 0.5},`,
    opts.status ? `    ["summary"] = { ["status"] = "${opts.status}", },` : '',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

describe('KOReader status onto a shelf state', () => {
  test('the four the device actually writes', () => {
    expect(shelfState('new', 0)).toBe('unread');
    expect(shelfState('reading', 0.3)).toBe('reading');
    expect(shelfState('complete', 1)).toBe('finished');
    // The useful one: most shelves cannot say a book was put down on purpose.
    expect(shelfState('abandoned', 0.13)).toBe('dnf');
  });

  test('no summary falls back to progress', () => {
    expect(shelfState(undefined, null)).toBe('unread');
    expect(shelfState(undefined, 0)).toBe('unread');
    expect(shelfState(undefined, 0.4)).toBe('reading');
    expect(shelfState(undefined, 1)).toBe('finished');
  });

  test('an unknown status is not trusted over the numbers', () => {
    expect(shelfState('something-new-upstream', 0.4)).toBe('reading');
  });
});

describe('deriving a book from a filename', () => {
  test("the sidecar path is KOReader's own derivation", () => {
    expect(sidecarPathFor('Pride and Prejudice.epub')).toBe(
      'Pride and Prejudice.sdr/metadata.epub.lua',
    );
    expect(sidecarPathFor('Moby Dick.EPUB')).toBe('Moby Dick.sdr/metadata.epub.lua');
  });

  test('a filename is a passable title when nothing better exists', () => {
    expect(titleFromFile('The_Long_Ships.epub')).toBe('The Long Ships');
  });
});

describe('reading a folder as the library', () => {
  test('a book with a sidecar carries everything the device knew', async () => {
    const books = await readShelf(
      folderOf({
        'Moby Dick.epub': '',
        'Moby Dick.sdr/metadata.epub.lua': sidecar({
          title: 'Moby Dick',
          author: 'Herman Melville',
          status: 'abandoned',
          percent: 0.137,
          annotations: [{ text: 'Call me Ishmael.', chapter: 'Loomings' }],
        }),
      }),
    );

    expect(books.length).toBe(1);
    const [book] = books;
    expect(book?.title).toBe('Moby Dick');
    expect(book?.author).toBe('Herman Melville');
    expect(book?.state).toBe('dnf');
    expect(book?.progress).toBeCloseTo(0.137, 4);
    expect(book?.annotations.length).toBe(1);
    expect(book?.annotations[0]?.chapter).toBe('Loomings');
  });

  // Half a library is books you have not started. That is a normal state, not
  // a broken one, and it must not need an import step to appear.
  test('a book with no sidecar is unread, not missing', async () => {
    const books = await readShelf(folderOf({ 'Emma.epub': '' }));
    expect(books.length).toBe(1);
    expect(books[0]?.state).toBe('unread');
    expect(books[0]?.title).toBe('Emma');
    expect(books[0]?.sidecar).toBeNull();
    expect(books[0]?.progress).toBeNull();
  });

  test('a sidecar that will not parse costs that book, never the shelf', async () => {
    const books = await readShelf(
      folderOf({
        'Good.epub': '',
        'Good.sdr/metadata.epub.lua': sidecar({ title: 'Good', percent: 0.5, status: 'reading' }),
        'Broken.epub': '',
        'Broken.sdr/metadata.epub.lua': 'this is not lua at all {{{',
      }),
    );
    expect(books.length).toBe(2);
    expect(books.find((b) => b.file === 'Good.epub')?.state).toBe('reading');
    expect(books.find((b) => b.file === 'Broken.epub')?.state).toBe('unread');
  });

  test('non-EPUB entries in the folder are ignored, .sdr directories included', async () => {
    const books = await readShelf(
      folderOf({
        'A.epub': '',
        'A.sdr': '',
        'notes.txt': '',
        '.DS_Store': '',
      }),
    );
    expect(books.map((b) => b.file)).toEqual(['A.epub']);
  });
});

describe('on deck: the cap is the product law', () => {
  const books = async (): Promise<Awaited<ReturnType<typeof readShelf>>> =>
    readShelf(
      folderOf({
        'Started Old.epub': '',
        'Started Old.sdr/metadata.epub.lua': sidecar({
          status: 'reading',
          annotations: [{ text: 'x', datetime: '2026-01-01 10:00:00' }],
        }),
        'Started New.epub': '',
        'Started New.sdr/metadata.epub.lua': sidecar({
          status: 'reading',
          annotations: [{ text: 'y', datetime: '2026-09-01 10:00:00' }],
        }),
        'Never Opened.epub': '',
        'Done.epub': '',
        'Done.sdr/metadata.epub.lua': sidecar({ status: 'complete', percent: 1 }),
        'Put Down.epub': '',
        'Put Down.sdr/metadata.epub.lua': sidecar({ status: 'abandoned', percent: 0.2 }),
      }),
    );

  test('books in progress come first, most recently touched first', async () => {
    const deck = onDeck(await books());
    expect(deck[0]?.file).toBe('Started New.epub');
    expect(deck[1]?.file).toBe('Started Old.epub');
  });

  test('finished and abandoned books are not next up', async () => {
    const deck = onDeck(await books());
    expect(deck.some((b) => b.file === 'Done.epub')).toBe(false);
    expect(deck.some((b) => b.file === 'Put Down.epub')).toBe(false);
  });

  test('the cap holds', async () => {
    expect(onDeck(await books(), 2).length).toBe(2);
  });
});

describe('the cross-book notebook', () => {
  const shelf = (): Promise<Awaited<ReturnType<typeof readShelf>>> =>
    readShelf(
      folderOf({
        'One.epub': '',
        'One.sdr/metadata.epub.lua': sidecar({
          title: 'One',
          annotations: [
            { text: 'a frigid winter night', chapter: 'Ch 1', datetime: '2026-09-01 10:00:00' },
            { text: 'something else', chapter: 'Ch 2', datetime: '2026-09-03 10:00:00' },
          ],
        }),
        'Two.epub': '',
        'Two.sdr/metadata.epub.lua': sidecar({
          title: 'Two',
          annotations: [
            {
              text: 'the night sky',
              note: 'about night',
              chapter: 'Ch 9',
              datetime: '2026-09-02 10:00:00',
            },
          ],
        }),
      }),
    );

  test('every highlight in the library, newest first', async () => {
    const rows = allAnnotations(await shelf());
    expect(rows.length).toBe(3);
    expect(rows[0]?.annotation.text).toBe('something else');
    expect(rows[0]?.book.title).toBe('One');
  });

  // "Where did I read about X?" is the question a per-book file browser
  // structurally cannot answer, and it is the reason this view exists.
  test('search spans books, and looks in notes and chapters too', async () => {
    const rows = allAnnotations(await shelf());
    const hits = searchAnnotations(rows, 'night');
    expect(hits.length).toBe(2);
    expect(new Set(hits.map((h) => h.book.title))).toEqual(new Set(['One', 'Two']));
  });

  test('an empty query is everything, not nothing', async () => {
    const rows = allAnnotations(await shelf());
    expect(searchAnnotations(rows, '   ').length).toBe(3);
  });
});
