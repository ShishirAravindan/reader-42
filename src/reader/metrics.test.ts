import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub, buildZip } from '../../test/fixture-epub.ts';
import { Book } from '../epub/book.ts';
import {
  LOCATION_SPAN,
  bookMetrics,
  charsBeforeId,
  excerptAt,
  flattenText,
  pageAnchors,
  rawOffsetOfElement,
} from './metrics.ts';

/** A minimal epub whose chapter texts are exactly known. */
function knownEpub(bodies: string[]): Uint8Array {
  const files: [string, string][] = [
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
    <dc:identifier id="uid">known-1</dc:identifier><dc:title>Known</dc:title>
  </metadata>
  <manifest>${bodies
    .map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('')}</manifest>
  <spine>${bodies.map((_, i) => `<itemref idref="c${i}"/>`).join('')}</spine>
</package>`,
    ],
    ...bodies.map((body, i): [string, string] => [
      `c${i}.xhtml`,
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${i}</title></head><body>${body}</body></html>`,
    ]),
  ];
  return buildZip(files);
}

describe('flattenText', () => {
  test('collapses whitespace runs and trims', () => {
    expect(flattenText('  a\n\t b   c ')).toBe('a b c');
    expect(flattenText('\n \t')).toBe('');
  });
});

describe('bookMetrics', () => {
  test('counts flattened chapter text exactly', async () => {
    // "Hello world" (11) + the "\n" between tags collapsing to a space + "Again." (6)
    const book = await Book.open(
      knownEpub(['<p>Hello   world</p>\n<p>Again.</p>', '<p> Twelve chars </p>']),
    );
    const m = bookMetrics(book);
    expect(m.chapterChars).toEqual(['Hello world Again.'.length, 'Twelve chars'.length]);
    expect(m.totalChars).toBe(18 + 12);
    expect(m.charsBefore(0)).toBe(0);
    expect(m.charsBefore(1)).toBe(18);
    expect(m.charsBefore(2)).toBe(30);
  });

  test('one location per LOCATION_SPAN chars, 1-based, never exceeding the total', async () => {
    const text = 'x'.repeat(LOCATION_SPAN * 3 + 10); // 3 full spans + a stub
    const book = await Book.open(knownEpub([`<p>${text}</p>`]));
    const m = bookMetrics(book);
    expect(m.totalLocations).toBe(4);
    expect(m.locationOf(0, 0)).toBe(1);
    expect(m.locationOf(0, 1)).toBe(4);
    // Fractions slightly out of range clamp instead of escaping the book.
    expect(m.locationOf(0, 1.2)).toBe(4);
    expect(m.locationOf(-1, 0)).toBe(1);
  });

  test('location is monotonic in fraction and chapter', async () => {
    const book = await Book.open(buildFixtureEpub());
    const m = bookMetrics(book);
    let last = 0;
    for (let chapter = 0; chapter < m.chapterChars.length; chapter++) {
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const loc = m.locationOf(chapter, fraction);
        expect(loc).toBeGreaterThanOrEqual(last);
        last = loc;
      }
    }
    expect(last).toBe(m.totalLocations);
  });

  test('last chapter at fraction 1 is the last location', async () => {
    const book = await Book.open(buildFixtureEpub());
    const m = bookMetrics(book);
    expect(m.locationOf(m.chapterChars.length - 1, 1)).toBe(m.totalLocations);
    expect(m.totalLocations).toBe(Math.max(1, Math.ceil(m.totalChars / LOCATION_SPAN)));
    // The fixture's long middle chapter dominates: sanity on magnitude.
    expect(m.totalLocations).toBeGreaterThan(50);
    expect(m.totalLocations).toBeLessThan(500);
  });

  test('an empty book still reports one location', async () => {
    const book = await Book.open(knownEpub(['<p> </p>']));
    const m = bookMetrics(book);
    expect(m.totalChars).toBe(0);
    expect(m.totalLocations).toBe(1);
    expect(m.locationOf(0, 0.5)).toBe(1);
  });
});

describe('placeAtLocation / placeAtChar', () => {
  test('round-trips the location index: every location maps back to itself', async () => {
    const book = await Book.open(buildFixtureEpub());
    const m = bookMetrics(book);
    for (const loc of [1, 2, 17, Math.floor(m.totalLocations / 2), m.totalLocations]) {
      const place = m.placeAtLocation(loc);
      expect(m.locationOf(place.chapter, place.fraction)).toBe(loc);
    }
  });

  test('out-of-range input clamps into the book instead of escaping it', async () => {
    const book = await Book.open(buildFixtureEpub());
    const m = bookMetrics(book);
    expect(m.placeAtLocation(0)).toEqual(m.placeAtLocation(1));
    expect(m.placeAtLocation(m.totalLocations + 999)).toEqual(m.placeAtLocation(m.totalLocations));
    expect(m.placeAtChar(-5)).toEqual({ chapter: 0, fraction: 0 });
  });

  test('a char offset lands in the chapter that contains it', async () => {
    const book = await Book.open(knownEpub(['<p>aaaa</p>', '<p>bbbbbbbb</p>', '<p>cc</p>']));
    const m = bookMetrics(book);
    expect(m.placeAtChar(0)).toEqual({ chapter: 0, fraction: 0 });
    expect(m.placeAtChar(4)).toEqual({ chapter: 1, fraction: 0 });
    expect(m.placeAtChar(8)).toEqual({ chapter: 1, fraction: 0.5 });
    expect(m.placeAtChar(12)).toEqual({ chapter: 2, fraction: 0 });
    expect(m.placeAtChar(99)).toEqual({ chapter: 2, fraction: 1 });
  });
});

describe('chapterText and chapterBody', () => {
  test('chapterText is the raw text-node data the renderer will mount', async () => {
    const book = await Book.open(knownEpub(['<p>the <em>quick</em> brown</p>']));
    const m = bookMetrics(book);
    // Raw, NOT collapsed: this is the coordinate system highlight boundaries
    // and search offsets speak against the live wrapper.
    expect(m.chapterText(0)).toBe('the quick brown');
    expect(m.chapterText(9)).toBe('');
  });

  test('active content is stripped before counting, as the renderer strips it', async () => {
    const book = await Book.open(knownEpub(['<p>kept</p><script>var gone = 1;</script>']));
    const m = bookMetrics(book);
    expect(m.chapterText(0)).toBe('kept');
    expect(m.chapterChars[0]).toBe(4);
  });

  test('chapterBody resolves structural paths without rendering', async () => {
    const book = await Book.open(knownEpub(['<h1>Title</h1><p>body text</p>']));
    const m = bookMetrics(book);
    const body = m.chapterBody(0);
    expect(body?.children.length).toBe(2);
    expect(m.chapterBody(0)).toBe(body); // cached, not re-parsed
    expect(m.chapterBody(5)).toBeNull();
  });
});

describe('excerptAt', () => {
  const text = 'The quick brown fox jumps over the lazy dog, deliberately and at length.';

  test('collapses whitespace and starts at the offset', () => {
    expect(excerptAt('a\n\n  b   c d', 0, 40)).toBe('a b c d');
    expect(excerptAt(text, 4, 11)).toBe('quick brown…');
  });

  test('cuts at a word boundary with an ellipsis', () => {
    const out = excerptAt(text, 0, 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(text.startsWith(out.slice(0, -1))).toBe(true);
    expect(out.slice(0, -1).trimEnd()).toBe(out.slice(0, -1)); // no dangling space
  });

  test('a short tail needs no ellipsis', () => {
    expect(excerptAt(text, text.length - 7, 40)).toBe('length.');
    expect(excerptAt(text, 999, 40)).toBe('');
  });
});

describe('rawOffsetOfElement', () => {
  test('counts raw text-node data strictly before the element', () => {
    const doc = new DOMParser().parseFromString(
      '<body><h1 id="top">Title</h1><p>One  two</p><p id="mark">three</p></body>',
      'text/html',
    );
    const body = doc.body;
    const at = (id: string): number | null => {
      const el = body.querySelector(`#${id}`);
      return el ? rawOffsetOfElement(body, el) : null;
    };
    expect(at('top')).toBe(0);
    // Raw, so the double space inside "One  two" counts as two.
    expect(at('mark')).toBe('TitleOne  two'.length);
    expect(rawOffsetOfElement(body, doc.createElement('p'))).toBeNull();
  });
});

describe('charsBeforeId', () => {
  test('counts flattened chars strictly before the element, in document order', () => {
    const doc = new DOMParser().parseFromString(
      '<body><h1 id="top">Title</h1><p>One  two</p><p id="mark">three</p></body>',
      'text/html',
    );
    const body = doc.body;
    expect(charsBeforeId(body, 'top')).toBe(0);
    // textContent semantics: adjacent blocks concatenate with no separator,
    // matching how the chapter totals are counted.
    expect(charsBeforeId(body, 'mark')).toBe('TitleOne two'.length);
    expect(charsBeforeId(body, 'ghost')).toBeNull();
  });
});

describe('pageAnchors', () => {
  test('maps the fixture page-list to monotonic global char offsets', async () => {
    const book = await Book.open(buildFixtureEpub());
    const m = bookMetrics(book);
    const anchors = pageAnchors(book, m);
    expect(anchors.map((a) => a.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    for (let i = 1; i < anchors.length; i++) {
      const prev = anchors[i - 1]?.globalChar ?? 0;
      const cur = anchors[i]?.globalChar ?? 0;
      expect(cur).toBeGreaterThan(prev);
    }
    // Page 1 starts at the very beginning; page 6 inside the last chapter.
    expect(anchors[0]?.globalChar).toBe(0);
    expect(anchors[5]?.globalChar).toBeGreaterThanOrEqual(m.charsBefore(2));
    expect(anchors[5]?.globalChar).toBeLessThanOrEqual(m.totalChars);
  });

  test('a book without a page-list yields no anchors', async () => {
    const book = await Book.open(knownEpub(['<p>text</p>']));
    expect(pageAnchors(book, bookMetrics(book))).toEqual([]);
  });
});
