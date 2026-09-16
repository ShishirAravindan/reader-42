import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import { Book } from '../epub/book.ts';
import { ingestSidecar } from './ingest.ts';

/** A sidecar in KOReader's own serialization, over the fixture book's text. */
function sidecar(entries: string[]): string {
  const annotations = entries.map((entry, i) => `        [${i + 1}] = ${entry},`).join('\n');
  return [
    '-- /library/fixture.sdr/metadata.epub.lua',
    'return {',
    '    ["annotations"] = {',
    annotations,
    '    },',
    '    ["doc_props"] = {',
    '        ["title"] = "The Fixture of Everything",',
    '        ["authors"] = "A. Test Author",',
    '    },',
    '    ["percent_finished"] = 0.5,',
    '}',
  ].join('\n');
}

function annotation(fields: Record<string, string | number>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `            ["${k}"] = ${typeof v === 'number' ? v : `"${v}"`},`)
    .join('\n');
  return `{\n${body}\n        }`;
}

const openFixture = (): Promise<Book> => Book.open(buildFixtureEpub());

describe('a KOReader sidecar against the book it describes', () => {
  test('resolved highlights land in the right chapter, with note and color', async () => {
    const book = await openFixture();
    const report = ingestSidecar(
      book,
      sidecar([
        annotation({
          text: 'The first chapter is short.',
          chapter: 'One: A Beginning',
          color: 'blue',
          note: 'it is',
          datetime: '2026-09-12 21:04:11',
          pos0: '/body/DocFragment[1]/body/p[1]/text().0',
        }),
        annotation({
          text: 'It ends, as chapters do,',
          chapter: 'Three: An End',
          color: 'orange',
          datetime: '2026-09-13 07:41:52',
          pos0: '/body/DocFragment[3]/body/p[1]/text().0',
        }),
      ]),
    );

    expect(report.title).toBe('The Fixture of Everything');
    expect(report.progress).toBeCloseTo(0.5, 6);
    expect(report.total).toBe(2);
    expect(report.resolved).toBe(2);
    expect(report.misses).toEqual([]);

    const [first, second] = report.highlights;
    expect(first?.chapter).toBe(0);
    expect(first?.color).toBe('blue');
    expect(first?.note).toBe('it is');
    expect(second?.chapter).toBe(2);
    expect(second?.color).toBe('orange');
  });

  test('the DocFragment hint is counted separately from a full scan', async () => {
    const book = await openFixture();
    const report = ingestSidecar(
      book,
      sidecar([
        // Correct hint: chapter 3 is spine index 2, DocFragment[3].
        annotation({
          text: 'It ends, as chapters do,',
          pos0: '/body/DocFragment[3]/body/p[1]/text().0',
        }),
        // Wrong hint: the text is in chapter 3, the pointer says chapter 1.
        annotation({
          text: 'as chapters do, quietly',
          pos0: '/body/DocFragment[1]/body/p[1]/text().0',
        }),
      ]),
    );

    expect(report.resolved).toBe(2);
    expect(report.viaHint).toBe(1);
    expect(report.viaScan).toBe(1);
    // Both still landed in the same real chapter: text is the true locator.
    expect(report.highlights.every((h) => h.chapter === 2)).toBe(true);
  });

  test('text that is not in the book is reported, not silently dropped', async () => {
    const book = await openFixture();
    const report = ingestSidecar(
      book,
      sidecar([
        annotation({
          text: 'The first chapter is short.',
          pos0: '/body/DocFragment[1]/body/p[1]/text().0',
        }),
        annotation({
          text: 'A sentence from a different edition entirely.',
          chapter: 'One: A Beginning',
          pos0: '/body/DocFragment[1]/body/p[9]/text().0',
        }),
      ]),
    );

    expect(report.total).toBe(2);
    expect(report.resolved).toBe(1);
    expect(report.misses.length).toBe(1);
    expect(report.misses[0]?.why).toBe('not-found');
    expect(report.misses[0]?.chapter).toBe('One: A Beginning');
  });

  // Re-importing the same sidecar must not grow the library a duplicate every
  // time: the sidecar merge unions by id (decisions.md 2026-08-01), so the id
  // has to be a function of the annotation rather than of the moment.
  test('ingesting twice yields identical ids', async () => {
    const book = await openFixture();
    const source = sidecar([
      annotation({
        text: 'The first chapter is short.',
        datetime: '2026-09-12 21:04:11',
        pos0: '/body/DocFragment[1]/body/p[1]/text().0',
      }),
    ]);
    const a = ingestSidecar(book, source);
    const b = ingestSidecar(book, source);
    expect(a.highlights[0]?.id).toBe(b.highlights[0]?.id ?? '');
  });

  test('a resolved highlight is a highlight the reader can render', async () => {
    const book = await openFixture();
    const report = ingestSidecar(
      book,
      sidecar([
        annotation({
          text: 'It ends, as chapters do,',
          pos0: '/body/DocFragment[3]/body/p[1]/text().0',
        }),
      ]),
    );
    const [highlight] = report.highlights;
    if (!highlight) throw new Error('expected one resolved highlight');
    // The shape the sidecar contract requires: structural path, integer
    // offsets, real text. Whether it renders is the acceptance scene's job.
    expect(Array.isArray(highlight.start.path)).toBe(true);
    expect(Number.isInteger(highlight.start.offset)).toBe(true);
    expect(highlight.end.offset).toBeGreaterThan(highlight.start.offset);
    expect(highlight.text).toBe('It ends, as chapters do,');
  });
});
