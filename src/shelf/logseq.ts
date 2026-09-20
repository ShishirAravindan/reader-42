// The Logseq off-ramp.
//
// One markdown outline per book: highlight text, the chapter the device
// recorded, a link, and the note when there is one. This is the whole
// integration surface with the graph — files out, nothing in.
//
// Lifted intact from the reader's notebook panel when the reader was retired.
// The escaping is the load-bearing half and the reason it was worth keeping:
// what leaves here is read back as SYNTAX by another program, so a book
// quoting `[[Moby Dick]]` must not mint a page on import, `*hurried*` must
// keep its asterisks, and a note typed on two lines must stay one block
// instead of splitting the outline in half from there down.

export interface OutlineItem {
  text: string;
  /** The chapter the device recorded — never a spine index (salvage §5). */
  chapterTitle: string;
  link: string;
  note?: string;
}

/** Markdown/Logseq syntax characters, backslash-escaped so they read as text. */
const SYNTAX = /[\\`*_[\]#{}]/g;

function escapeSyntax(text: string): string {
  return text.replace(SYNTAX, (c) => `\\${c}`);
}

/**
 * Escaped, and guaranteed to occupy exactly one line. The two replaces after
 * the escape neutralize a line-leading list or quote marker, which would
 * otherwise make a new block out of what is meant to be text.
 */
function inlineText(text: string): string {
  return escapeSyntax(text.replace(/\s*[\r\n]+\s*/g, ' '))
    .replace(/^(\s*)([-+>])(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*\d+)(\.)(\s|$)/, '$1\\$2$3');
}

/**
 * Escaped, keeping the reader's line breaks. Blank lines collapse: a blank
 * line ends a block in markdown, and keeping the note inside its own block
 * matters more than preserving an empty line inside it.
 */
function blockText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n')
    .split('\n')
    .map((line) => inlineText(line))
    .join('\n');
}

/**
 * One outline block. Continuation lines are indented past the bullet's own
 * marker and carry no `-`, which is how markdown outliners read them as more
 * of this block rather than as the next one.
 */
function bullet(indent: string, body: string): string[] {
  const [first = '', ...rest] = body.split('\n');
  return [`${indent}- ${first}`, ...rest.map((line) => `${indent}  ${line}`)];
}

/** One markdown outline per book: `# title`, then a bullet per highlight
 * with chapter title, deep link, and (when present) the note as sub-bullets. */
export function logseqOutline(title: string, items: OutlineItem[]): string {
  const lines = [`# ${inlineText(title)}`];
  for (const item of items) {
    lines.push(...bullet('', blockText(item.text)));
    lines.push(...bullet('  ', inlineText(item.chapterTitle)));
    // The link is ours, not the book's: it is generated from an id, so it
    // needs no escaping — and escaping it would break the URL.
    lines.push(`  - [link](${item.link})`);
    if (item.note) lines.push(...bullet('  ', `note: ${blockText(item.note)}`));
  }
  return `${lines.join('\n')}\n`;
}

// --- the panel ---
