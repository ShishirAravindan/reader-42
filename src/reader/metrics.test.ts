import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub, buildZip } from '../../test/fixture-epub.ts';
import { Book } from '../epub/book.ts';
import { LOCATION_SPAN, bookMetrics, flattenText } from './metrics.ts';

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
