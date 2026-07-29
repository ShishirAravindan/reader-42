import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub, buildZip } from '../../test/fixture-epub.ts';
import { Book, readMetadata } from './book.ts';
import { parseLandmarks, parsePageList } from './parser.ts';
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

  test('parses the page-list nav into print page targets (B2)', async () => {
    const book = await Book.open(buildFixtureEpub());
    expect(book.pageList.map((p) => p.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(book.pageList[0]).toEqual({ label: '1', path: 'OEBPS/ch1.xhtml', fragment: 'c1' });
    expect(book.pageList[3]).toEqual({ label: '4', path: 'OEBPS/ch2.xhtml', fragment: 'p40' });
    expect(book.pageList[5]).toEqual({ label: '6', path: 'OEBPS/ch3.xhtml', fragment: 'c3' });
  });

  test('pageList is empty when the book carries no page-list nav', async () => {
    const book = await Book.open(rtlEpub('ltr'));
    expect(book.pageList).toEqual([]);
  });

  test('reads spine page-progression-direction, defaulting to ltr', async () => {
    expect((await Book.open(buildFixtureEpub())).direction).toBe('ltr');
    expect((await Book.open(rtlEpub('rtl'))).direction).toBe('rtl');
    // "default" and junk both degrade to ltr rather than propagating.
    expect((await Book.open(rtlEpub('default'))).direction).toBe('ltr');
    expect((await Book.open(rtlEpub('sideways'))).direction).toBe('ltr');
  });
});

describe('parsePageList', () => {
  const navDoc = (body: string): string =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>nav</title></head><body>${body}</body></html>`;

  test('reads ops-namespaced page-list entries with resolved paths', () => {
    const pages = parsePageList(
      navDoc(
        `<nav epub:type="toc"><ol><li><a href="ch1.xhtml">One</a></li></ol></nav>
         <nav epub:type="page-list"><ol>
           <li><a href="ch1.xhtml#pg1">1</a></li>
           <li><a href="text/ch2.xhtml#pg2">2</a></li>
         </ol></nav>`,
      ),
      'OEBPS/nav.xhtml',
    );
    expect(pages).toEqual([
      { label: '1', path: 'OEBPS/ch1.xhtml', fragment: 'pg1' },
      { label: '2', path: 'OEBPS/text/ch2.xhtml', fragment: 'pg2' },
    ]);
  });

  test('accepts epub:type outside the ops namespace (wild files)', () => {
    // xmlns:epub bound to the wrong URI: getAttributeNS(ops) misses, the
    // literal-name fallback still finds it, same as the toc code.
    const xml = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="urn:not-ops">
<head><title>n</title></head>
<body><nav epub:type="page-list"><ol><li><a href="a.xhtml#p">iv</a></li></ol></nav></body></html>`;
    expect(parsePageList(xml, 'nav.xhtml')[0]?.label).toBe('iv');
  });

  test('no page-list nav (toc only) yields an empty list, never a toc bleed', () => {
    const pages = parsePageList(
      navDoc('<nav epub:type="toc"><ol><li><a href="ch1.xhtml">One</a></li></ol></nav>'),
      'nav.xhtml',
    );
    expect(pages).toEqual([]);
  });

  test('entries without a label or href are skipped', () => {
    const pages = parsePageList(
      navDoc(
        `<nav epub:type="page-list"><ol>
           <li><a href="a.xhtml#p1">1</a></li>
           <li><a href="a.xhtml#p2"> </a></li>
           <li><span>3</span></li>
         </ol></nav>`,
      ),
      'nav.xhtml',
    );
    expect(pages.map((p) => p.label)).toEqual(['1']);
  });
});

describe('parseLandmarks', () => {
  const navDoc = (body: string): string =>
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>nav</title></head><body>${body}</body></html>`;

  test("reads the publisher's own names for places, with resolved paths", () => {
    const marks = parseLandmarks(
      navDoc(
        `<nav epub:type="landmarks"><ol>
           <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
           <li><a epub:type="bodymatter" href="text/ch2.xhtml">Start Reading</a></li>
         </ol></nav>`,
      ),
      'OEBPS/nav.xhtml',
    );
    expect(marks).toEqual([
      { type: 'cover', path: 'OEBPS/cover.xhtml', fragment: null },
      { type: 'bodymatter', path: 'OEBPS/text/ch2.xhtml', fragment: null },
    ]);
  });

  test('entries without an epub:type or href are meaningless and dropped', () => {
    const marks = parseLandmarks(
      navDoc(
        `<nav epub:type="landmarks"><ol>
           <li><a href="a.xhtml">Untyped</a></li>
           <li><a epub:type="toc">No href</a></li>
         </ol></nav>`,
      ),
      'nav.xhtml',
    );
    expect(marks).toEqual([]);
  });

  test('a book with no landmarks nav yields nothing, never a toc bleed', () => {
    expect(
      parseLandmarks(
        navDoc('<nav epub:type="toc"><ol><li><a href="a.xhtml">A</a></li></ol></nav>'),
        'nav.xhtml',
      ),
    ).toEqual([]);
  });
});

describe('Book.beginning', () => {
  test('the bodymatter landmark names where the book proper starts', async () => {
    const book = await Book.open(
      landmarkEpub('<a epub:type="bodymatter" href="ch2.xhtml">Start</a>'),
    );
    expect(book.beginning).toBe(1);
  });

  test('no landmark, an unresolvable one, or one at the cover falls back to chapter 0', async () => {
    expect((await Book.open(landmarkEpub(''))).beginning).toBe(0);
    expect(
      (await Book.open(landmarkEpub('<a epub:type="bodymatter" href="missing.xhtml">S</a>')))
        .beginning,
    ).toBe(0);
    expect(
      (await Book.open(landmarkEpub('<a epub:type="bodymatter" href="ch1.xhtml">S</a>'))).beginning,
    ).toBe(0);
  });
});

function landmarkEpub(entry: string): Uint8Array {
  const chapter = (n: number): string =>
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${n}</title></head><body><p>c${n}</p></body></html>`;
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
    <dc:identifier id="uid">lm-1</dc:identifier><dc:title>Landmarks</dc:title>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`,
    ],
    [
      'nav.xhtml',
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>nav</title></head><body>
  <nav epub:type="toc"><ol><li><a href="ch1.xhtml">One</a></li></ol></nav>
  ${entry ? `<nav epub:type="landmarks"><ol><li>${entry}</li></ol></nav>` : ''}
</body></html>`,
    ],
    ['ch1.xhtml', chapter(1)],
    ['ch2.xhtml', chapter(2)],
  ]);
}

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
