import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub, buildZip } from '../../test/fixture-epub.ts';
import { Book, readMetadata } from './book.ts';
import { resolveAgainst, splitFragment } from './path.ts';
import { Zip } from './zip.ts';

describe('zip', () => {
  test('lists and reads stored entries byte-for-byte', async () => {
    const zip = await Zip.open(
      buildZip([
        ['a.txt', 'hello'],
        ['dir/b.bin', new Uint8Array([1, 2, 3])],
      ]),
    );
    expect(zip.list()).toEqual(['a.txt', 'dir/b.bin']);
    expect(await zip.readText('a.txt')).toBe('hello');
    expect(await zip.read('dir/b.bin')).toEqual(new Uint8Array([1, 2, 3]));
  });

  test('missing entries throw, garbage input throws', async () => {
    const zip = await Zip.open(buildZip([['a.txt', 'x']]));
    expect(zip.read('ghost')).rejects.toThrow('missing entry');
    expect(Zip.open(new TextEncoder().encode('not a zip'))).rejects.toThrow(
      'end-of-central-directory',
    );
  });
});

describe('path', () => {
  test('resolves relative to the referencing file', () => {
    expect(resolveAgainst('OEBPS/content.opf', 'ch1.xhtml')).toBe('OEBPS/ch1.xhtml');
    expect(resolveAgainst('OEBPS/text/ch1.xhtml', '../images/fig.png')).toBe(
      'OEBPS/images/fig.png',
    );
    expect(resolveAgainst('a/b/c.xhtml', './d.xhtml')).toBe('a/b/d.xhtml');
  });

  test('splits fragments', () => {
    expect(splitFragment('ch2.xhtml#p30')).toEqual({ path: 'ch2.xhtml', fragment: 'p30' });
    expect(splitFragment('ch2.xhtml')).toEqual({ path: 'ch2.xhtml', fragment: null });
  });
});

describe('Book', () => {
  test('opens the fixture: metadata, spine order, toc', async () => {
    const book = await Book.open(buildFixtureEpub());
    expect(book.metadata.title).toBe('The Fixture of Everything');
    expect(book.metadata.author).toBe('A. Test Author');
    expect(book.chapters.map((c) => c.path)).toEqual([
      'OEBPS/ch1.xhtml',
      'OEBPS/ch2.xhtml',
      'OEBPS/ch3.xhtml',
    ]);
    expect(book.toc.map((t) => t.label)).toEqual([
      'One: A Beginning',
      'Two: The Long Middle',
      'Three: An End',
    ]);
    expect(book.toc[1]?.children[0]?.fragment).toBe('p30');
  });

  test('resolves resources synchronously and weights chapters by size', async () => {
    const book = await Book.open(buildFixtureEpub());
    expect(book.resolveResource('OEBPS/style.css')?.mediaType).toBe('text/css');
    expect(book.resolveResource('OEBPS/ghost.png')).toBeNull();
    const weights = book.chapterWeights();
    expect(weights).toHaveLength(3);
    // The long middle chapter dominates the fixture by construction.
    expect(Math.max(...weights)).toBe(weights[1] as number);
  });

  test('readMetadata gets title/author without a full open', async () => {
    const meta = await readMetadata(buildFixtureEpub());
    expect(meta.title).toBe('The Fixture of Everything');
    expect(meta.author).toBe('A. Test Author');
  });

  test('chapterIndexByPath maps toc targets to spine positions', async () => {
    const book = await Book.open(buildFixtureEpub());
    expect(book.chapterIndexByPath('OEBPS/ch2.xhtml')).toBe(1);
    expect(book.chapterIndexByPath('OEBPS/nav.xhtml')).toBe(-1);
  });

  test('reads spine page-progression-direction, defaulting to ltr', async () => {
    expect((await Book.open(buildFixtureEpub())).direction).toBe('ltr');
    expect((await Book.open(rtlEpub('rtl'))).direction).toBe('rtl');
    // "default" and junk both degrade to ltr rather than propagating.
    expect((await Book.open(rtlEpub('default'))).direction).toBe('ltr');
    expect((await Book.open(rtlEpub('sideways'))).direction).toBe('ltr');
  });
});

function rtlEpub(progression: string): Uint8Array {
  return buildZip([
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    ],
    [
      'content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">rtl-1</dc:identifier><dc:title>RTL</dc:title>
  </metadata>
  <manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine page-progression-direction="${progression}"><itemref idref="ch1"/></spine>
</package>`,
    ],
    [
      'ch1.xhtml',
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>1</title></head><body><p>x</p></body></html>',
    ],
  ]);
}
