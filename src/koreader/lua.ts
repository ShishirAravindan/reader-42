// Reading KOReader's sidecar serialization.
//
// KOReader persists everything it knows about a book as a Lua source file
// (`metadata.epub.lua` inside `<book>.sdr/`), written by its own `dump.lua`
// and wrapped by `util.writeToFile(..., lua_dofile_ready = true)`:
//
//     -- /path/to/book.sdr/metadata.epub.lua
//     return {
//         ["annotations"] = {
//             [1] = {
//                 ["chapter"] = "Chapter 3",
//             },
//         },
//         ["percent_finished"] = 0.23,
//     }
//
// KOReader reads these back with `dofile`. We do not: this file arrives from
// a device, through a synced folder, and executing it would hand whatever
// wrote it our process. So this is a parser, never an evaluator — it accepts
// the value grammar `dump.lua` can emit and nothing else.
//
// The grammar is genuinely small because dump.lua is small: every table entry
// is `[key] = value,` (string keys included, which is why there is no bare
// identifier form here), strings come from `string.format("%q", ...)`, and
// numbers from `tostring`. Cycles are emitted as `nil --[[ LOOP: ... ]]`,
// so comments have to be skippable rather than an error.

/** A parsed Lua table: dump.lua writes arrays and records the same way, so
 * integer and string keys share one map rather than guessing which it meant. */
export interface LuaTable {
  entries: Map<string | number, LuaValue>;
}

export type LuaValue = string | number | boolean | null | LuaTable;

/** Nesting cap. A sidecar is a handful of levels deep; anything beyond this is
 * malformed or hostile, and either way should stop rather than blow the stack. */
const MAX_DEPTH = 64;

export class LuaParseError extends Error {}

export function isTable(value: LuaValue): value is LuaTable {
  return typeof value === 'object' && value !== null;
}

/** Read one key out of a table, or undefined. */
export function get(table: LuaTable, key: string | number): LuaValue | undefined {
  return table.entries.get(key);
}

/** A table's `[1]`, `[2]`, … run, stopping at the first gap — Lua's own array
 * convention, and what dump.lua produces for a sequence. */
export function array(table: LuaTable): LuaValue[] {
  const out: LuaValue[] = [];
  for (let i = 1; ; i++) {
    const value = table.entries.get(i);
    if (value === undefined) return out;
    out.push(value);
  }
}

/** Typed reads. A sidecar is foreign data: a field of the wrong type degrades
 * to "absent" rather than throwing, so one odd record never costs the book. */
export function str(table: LuaTable, key: string | number): string | undefined {
  const value = get(table, key);
  return typeof value === 'string' ? value : undefined;
}

export function num(table: LuaTable, key: string | number): number | undefined {
  const value = get(table, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function table(source: LuaTable, key: string | number): LuaTable | undefined {
  const value = get(source, key);
  return value !== undefined && isTable(value) ? value : undefined;
}

/**
 * Parse a whole sidecar file: the leading `-- <path>` comment, `return`, and
 * the value. Throws LuaParseError on anything outside dump.lua's grammar.
 */
export function parseSidecar(source: string): LuaValue {
  const p = new Parser(source);
  p.skipTrivia();
  p.expectWord('return');
  const value = p.value(0);
  p.skipTrivia();
  if (!p.done()) throw new LuaParseError(`trailing input at offset ${p.at()}`);
  return value;
}

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  at(): number {
    return this.i;
  }

  done(): boolean {
    return this.i >= this.src.length;
  }

  /** Whitespace plus Lua comments, including the `--[[ ... ]]` block form
   * dump.lua emits for cycles. */
  skipTrivia(): void {
    for (;;) {
      while (this.i < this.src.length && /\s/.test(this.src[this.i] as string)) this.i++;
      if (this.src.startsWith('--', this.i)) {
        this.i += 2;
        const block = /^\[(=*)\[/.exec(this.src.slice(this.i));
        if (block) {
          const close = `]${block[1] as string}]`;
          const end = this.src.indexOf(close, this.i + (block[0] as string).length);
          if (end === -1) throw new LuaParseError('unterminated block comment');
          this.i = end + close.length;
        } else {
          const nl = this.src.indexOf('\n', this.i);
          this.i = nl === -1 ? this.src.length : nl;
        }
        continue;
      }
      return;
    }
  }

  expectWord(word: string): void {
    if (!this.src.startsWith(word, this.i)) {
      throw new LuaParseError(`expected "${word}" at offset ${this.i}`);
    }
    this.i += word.length;
  }

  private expectChar(ch: string): void {
    this.skipTrivia();
    if (this.src[this.i] !== ch) {
      throw new LuaParseError(`expected "${ch}" at offset ${this.i}`);
    }
    this.i++;
  }

  value(depth: number): LuaValue {
    if (depth > MAX_DEPTH) throw new LuaParseError('nesting too deep');
    this.skipTrivia();
    const ch = this.src[this.i];
    if (ch === undefined) throw new LuaParseError('unexpected end of input');
    if (ch === '{') return this.tableValue(depth);
    if (ch === '"' || ch === "'") return this.stringValue();
    if (this.src.startsWith('true', this.i)) {
      this.i += 4;
      return true;
    }
    if (this.src.startsWith('false', this.i)) {
      this.i += 5;
      return false;
    }
    if (this.src.startsWith('nil', this.i)) {
      this.i += 3;
      return null;
    }
    return this.numberValue();
  }

  private tableValue(depth: number): LuaTable {
    this.expectChar('{');
    const entries = new Map<string | number, LuaValue>();
    for (;;) {
      this.skipTrivia();
      if (this.src[this.i] === '}') {
        this.i++;
        return { entries };
      }
      this.expectChar('[');
      const key = this.value(depth + 1);
      if (typeof key !== 'string' && typeof key !== 'number') {
        throw new LuaParseError(`unsupported table key at offset ${this.i}`);
      }
      this.expectChar(']');
      this.expectChar('=');
      // A `nil` value is an absent key in Lua; keep the map faithful to that
      // rather than storing a null nobody can tell from a real value.
      const value = this.value(depth + 1);
      if (value !== null) entries.set(key, value);
      this.skipTrivia();
      if (this.src[this.i] === ',' || this.src[this.i] === ';') this.i++;
    }
  }

  /**
   * A `%q` string. Lua escapes `"` and `\`, writes a real newline as
   * backslash-newline, and falls back to decimal escapes (`\13`) for control
   * characters, so all three forms have to come back.
   */
  private stringValue(): string {
    const quote = this.src[this.i] as string;
    this.i++;
    let out = '';
    for (;;) {
      const ch = this.src[this.i];
      if (ch === undefined) throw new LuaParseError('unterminated string');
      if (ch === quote) {
        this.i++;
        return out;
      }
      if (ch !== '\\') {
        out += ch;
        this.i++;
        continue;
      }
      this.i++;
      const esc = this.src[this.i];
      if (esc === undefined) throw new LuaParseError('unterminated escape');
      if (esc === '\n') {
        out += '\n';
        this.i++;
        continue;
      }
      if (esc === 'z') {
        // \z swallows the whitespace that follows it.
        this.i++;
        while (this.i < this.src.length && /\s/.test(this.src[this.i] as string)) this.i++;
        continue;
      }
      if (esc === 'x') {
        const hex = /^[0-9a-fA-F]{2}/.exec(this.src.slice(this.i + 1));
        if (!hex) throw new LuaParseError(`bad \\x escape at offset ${this.i}`);
        out += String.fromCharCode(Number.parseInt(hex[0], 16));
        this.i += 1 + hex[0].length;
        continue;
      }
      if (/[0-9]/.test(esc)) {
        const dec = /^[0-9]{1,3}/.exec(this.src.slice(this.i)) as RegExpExecArray;
        out += String.fromCharCode(Number.parseInt(dec[0], 10));
        this.i += dec[0].length;
        continue;
      }
      const simple: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        a: '\x07',
        b: '\b',
        f: '\f',
        v: '\v',
        '\\': '\\',
        '"': '"',
        "'": "'",
      };
      const mapped = simple[esc];
      if (mapped === undefined) throw new LuaParseError(`unknown escape \\${esc}`);
      out += mapped;
      this.i++;
    }
  }

  /** `tostring(number)`: integers, decimals, exponents, hex, and the
   * inf/nan spellings Lua prints when a float goes wrong. */
  private numberValue(): number {
    const rest = this.src.slice(this.i);
    const match =
      /^-?(0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]*)?([pP][-+]?[0-9]+)?|(inf|nan)|[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)/.exec(
        rest,
      );
    if (!match) throw new LuaParseError(`expected a value at offset ${this.i}`);
    const text = match[0];
    this.i += text.length;
    if (/inf$/.test(text))
      return text.startsWith('-') ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    if (/nan$/.test(text)) return Number.NaN;
    return Number(text);
  }
}
