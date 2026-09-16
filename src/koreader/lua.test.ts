import { describe, expect, test } from 'bun:test';
import { type LuaTable, array, isTable, num, parseSidecar, str, table } from './lua.ts';

const FIXTURE = Bun.file(new URL('../../test/fixture-koreader-sidecar.lua', import.meta.url));

function parseTable(source: string): LuaTable {
  const value = parseSidecar(source);
  if (!isTable(value)) throw new Error('expected a table');
  return value;
}

describe('the dump.lua grammar', () => {
  test('reads a table of scalars', () => {
    const t = parseTable('return {\n    ["a"] = "x",\n    ["b"] = 2,\n    ["c"] = true,\n}');
    expect(str(t, 'a')).toBe('x');
    expect(num(t, 'b')).toBe(2);
    expect(t.entries.get('c')).toBe(true);
  });

  test('a nil value is an absent key, as it is in Lua', () => {
    const t = parseTable('return { ["present"] = 1, ["gone"] = nil, }');
    expect(t.entries.has('present')).toBe(true);
    expect(t.entries.has('gone')).toBe(false);
  });

  test('integer keys read back as an array, stopping at the first gap', () => {
    const t = parseTable('return { [1] = "a", [2] = "b", [4] = "d", }');
    expect(array(t).length).toBe(2);
  });

  // Lua's %q writes a newline as backslash + a real newline. Getting this
  // wrong silently truncates every multi-line note a reader ever wrote.
  test('a backslash-newline escape is a newline', () => {
    const t = parseTable('return { ["note"] = "one\\\ntwo", }');
    expect(str(t, 'note')).toBe('one\ntwo');
  });

  test('quotes, backslashes and decimal escapes', () => {
    const t = parseTable('return { ["s"] = "a\\"b\\\\c\\13d", }');
    expect(str(t, 's')).toBe('a"b\\c\rd');
  });

  test('non-ASCII passes through: %q leaves bytes above 127 alone', () => {
    const t = parseTable('return { ["s"] = "tête-à-tête — “quoted”", }');
    expect(str(t, 's')).toBe('tête-à-tête — “quoted”');
  });

  test('comments are skipped, including the block form dump.lua writes for cycles', () => {
    const t = parseTable('-- header\nreturn { ["a"] = nil --[[ LOOP:\n ^--- ]], ["b"] = 1, }');
    expect(num(t, 'b')).toBe(1);
  });

  test('floats, negatives and exponents', () => {
    const t = parseTable('return { ["a"] = 0.2913, ["b"] = -3, ["c"] = 1e+15, }');
    expect(num(t, 'a')).toBeCloseTo(0.2913, 6);
    expect(num(t, 'b')).toBe(-3);
    expect(num(t, 'c')).toBe(1e15);
  });

  test('a typed read of the wrong type degrades to absent rather than throwing', () => {
    const t = parseTable('return { ["n"] = "not a number", }');
    expect(num(t, 'n')).toBeUndefined();
    expect(table(t, 'n')).toBeUndefined();
  });

  test('malformed input is an error, never a partial parse', () => {
    expect(() => parseSidecar('return { ["a"] = ')).toThrow();
    expect(() => parseSidecar('{ ["a"] = 1 }')).toThrow(); // no `return`
    expect(() => parseSidecar('return { ["a"] = 1, } trailing')).toThrow();
  });

  // The file arrives from a device through a synced folder. KOReader itself
  // reads it with dofile; we must never do that, and this is the reminder.
  test('an executable payload is data, not code', () => {
    expect(() => parseSidecar('return os.execute("id")')).toThrow();
  });
});

describe('a sidecar KOReader actually serialized', () => {
  test('parses, and carries the fields the seam depends on', async () => {
    const root = parseTable(await FIXTURE.text());

    expect(num(root, 'percent_finished')).toBeCloseTo(0.2913, 6);
    expect(num(root, 'cre_dom_version')).toBe(20240114);

    const props = table(root, 'doc_props');
    expect(props && str(props, 'title')).toBe('Pride and Prejudice');
    expect(props && str(props, 'authors')).toBe('Jane Austen');

    const annotations = table(root, 'annotations');
    expect(annotations).toBeDefined();
    const list = array(annotations as LuaTable);
    expect(list.length).toBe(4);

    const first = list[0];
    if (!first || !isTable(first)) throw new Error('expected an annotation table');
    expect(str(first, 'text')).toBe('A single man of large fortune; four or five thousand a year.');
    expect(str(first, 'chapter')).toBe('CHAPTER I.');
    expect(str(first, 'pos0')).toBe('/body/DocFragment[3]/body/div/p[2]/text().0');

    // The multi-line note is the escape that would fail silently.
    const third = list[2];
    if (!third || !isTable(third)) throw new Error('expected an annotation table');
    expect(str(third, 'note')).toBe(
      'Three people, a path for two.\nThe whole book in one line of blocking.',
    );
  });
});
