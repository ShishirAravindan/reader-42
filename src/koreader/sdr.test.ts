import { describe, expect, test } from 'bun:test';
import {
  HIGHLIGHT_COLORS,
  mapColor,
  readSidecar,
  spineIndexFromXPointer,
  toIsoish,
} from './sdr.ts';

const FIXTURE = Bun.file(new URL('../../test/fixture-koreader-sidecar.lua', import.meta.url));

describe('what an xpointer can and cannot tell us', () => {
  test('the DocFragment index is the spine item, one-based there and zero-based here', () => {
    expect(spineIndexFromXPointer('/body/DocFragment[3]/body/div/p[2]/text().0')).toBe(2);
    expect(spineIndexFromXPointer('/body/DocFragment[1]/body/p[1]/text().0')).toBe(0);
  });

  test('anything without a DocFragment yields no hint rather than a wrong one', () => {
    expect(spineIndexFromXPointer('/body/p[4]/text().2')).toBeNull();
    expect(spineIndexFromXPointer(undefined)).toBeNull();
    expect(spineIndexFromXPointer('DocFragment[0]')).toBeNull();
  });
});

describe('the palette crossing', () => {
  test('every mapped color is one reader-42 actually has', () => {
    const koColors = [
      'red',
      'orange',
      'yellow',
      'green',
      'olive',
      'cyan',
      'blue',
      'purple',
      'gray',
      undefined,
      'chartreuse',
    ];
    for (const color of koColors) {
      expect(HIGHLIGHT_COLORS).toContain(mapColor(color));
    }
  });

  test('warm stays warm, cool stays cool, the rest default to yellow', () => {
    expect(mapColor('orange')).toBe('orange');
    expect(mapColor('cyan')).toBe('blue');
    expect(mapColor('purple')).toBe('pink');
    expect(mapColor('olive')).toBe('yellow');
    expect(mapColor(undefined)).toBe('yellow');
  });
});

describe('timestamps', () => {
  // KOReader writes device-local wall time with no zone. Adding one would be
  // inventing information, so the value stays zone-less ISO 8601.
  test('a KOReader datetime becomes zone-less ISO 8601', () => {
    expect(toIsoish('2026-09-12 21:04:11')).toBe('2026-09-12T21:04:11');
  });

  test('an unparseable datetime is passed through rather than guessed at', () => {
    expect(toIsoish('sometime last week')).toBe('sometime last week');
  });
});

describe('reading the sidecar KOReader serialized', () => {
  test('carries title, progress, status and every annotation', async () => {
    const sidecar = readSidecar(await FIXTURE.text());

    expect(sidecar.title).toBe('Pride and Prejudice');
    expect(sidecar.author).toBe('Jane Austen');
    expect(sidecar.percentFinished).toBeCloseTo(0.2913, 6);
    expect(sidecar.status).toBe('reading');
    expect(sidecar.annotations.length).toBe(4);

    const [first] = sidecar.annotations;
    expect(first?.chapter).toBe('CHAPTER I.');
    expect(first?.color).toBe('yellow');
    expect(first?.createdAt).toBe('2026-09-12T21:04:11');
    expect(first?.spineHint).toBe(2);

    expect(sidecar.annotations[1]?.color).toBe('blue');
    expect(sidecar.annotations[2]?.note).toContain('one line of blocking');
  });

  test('a progress value outside 0..1 is refused rather than displayed', () => {
    const sidecar = readSidecar('return { ["percent_finished"] = 42, }');
    expect(sidecar.percentFinished).toBeNull();
  });

  test('a page bookmark carries no text, so it is not a highlight', () => {
    const sidecar = readSidecar(
      'return { ["annotations"] = { [1] = { ["page"] = "/body/DocFragment[2]/body/p[1]/text().0", }, }, }',
    );
    expect(sidecar.annotations.length).toBe(0);
  });
});

// An end-to-end read produced a sidecar with a rating, a review, a finish
// date, keywords and per-highlight page numbers — and the shelf displayed
// none of them, because the parser read past all of it. These pin the fields
// that carry the "reward for having read" half of the product.
describe('the fields it is easiest to skip', () => {
  const withSummary = [
    'return {',
    '    ["annotations"] = {',
    '        [1] = {',
    '            ["datetime"] = "2026-09-20 13:21:26",',
    '            ["pageno"] = 15,',
    '            ["pos0"] = "/body/DocFragment[2]/body/p[81]/text().81",',
    '            ["text"] = "a strange, provoking, formless sort of figure",',
    '        },',
    '    },',
    '    ["doc_props"] = {',
    '        ["keywords"] = "Psychological fiction\\',
    'Feminist fiction",',
    '        ["title"] = "The Yellow Wallpaper",',
    '    },',
    '    ["summary"] = {',
    '        ["modified"] = "2026-09-20",',
    '        ["note"] = "A rest cure told from inside.",',
    '        ["rating"] = 4,',
    '        ["status"] = "complete",',
    '    },',
    '}',
  ].join('\n');

  test('the star rating crosses', () => {
    expect(readSidecar(withSummary).rating).toBe(4);
  });

  test('the review crosses', () => {
    expect(readSidecar(withSummary).review).toBe('A rest cure told from inside.');
  });

  test('the day it was finished crosses', () => {
    expect(readSidecar(withSummary).statusChangedAt).toBe('2026-09-20');
  });

  test('keywords are one string in the file and a list here', () => {
    expect(readSidecar(withSummary).keywords).toEqual([
      'Psychological fiction',
      'Feminist fiction',
    ]);
  });

  // The xpointer cannot locate a highlight on this side, but the page number
  // is how a person walks a quote back to its place in the book.
  test('the page number rides with its highlight', () => {
    expect(readSidecar(withSummary).annotations[0]?.pageno).toBe(15);
  });

  test('an unrated book carries no rating rather than a zero', () => {
    const sidecar = readSidecar('return { ["summary"] = { ["rating"] = 0, }, }');
    expect(sidecar.rating).toBeUndefined();
  });

  test('a book with no summary at all still parses', () => {
    const sidecar = readSidecar('return { ["percent_finished"] = 0.4, }');
    expect(sidecar.rating).toBeUndefined();
    expect(sidecar.review).toBeUndefined();
    expect(sidecar.keywords).toEqual([]);
  });
});
