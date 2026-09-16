import { describe, expect, test } from 'bun:test';
import { HIGHLIGHT_COLORS } from '../library/types.ts';
import { mapColor, readSidecar, spineIndexFromXPointer, toIsoish } from './sdr.ts';

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
