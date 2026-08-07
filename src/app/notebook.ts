// The Notebook (parity F4): every highlight and note in the book, in book
// order, filterable by color, each row jumping to its place, plus the Logseq
// export — one markdown outline per book (salvage §5: highlight text, chapter
// title — never spine indices — deep link, optional note).
//
// The pure pieces (ordering, chapter-title mapping, the outline format) live
// at the top and are unit-tested; the panel below mirrors the TOC pattern.

import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../library/types.ts';
import { comparePaths } from '../reader/locator.ts';

// --- pure: book ordering ---

export { comparePaths };

/** Book order: chapter, then start path, then start offset (id tiebreak). */
export function sortHighlights(highlights: Highlight[]): Highlight[] {
  return [...highlights].sort(
    (x, y) =>
      x.chapter - y.chapter ||
      comparePaths(x.start.path, y.start.path) ||
      x.start.offset - y.start.offset ||
      (x.id < y.id ? -1 : 1),
  );
}

// --- pure: chapter titles ---

export interface TocLike {
  label: string;
  path: string;
  children: TocLike[];
}

/**
 * Human chapter titles per spine index, from the TOC (salvage §5: never show
 * spine indices). A chapter's own first TOC entry names it; a chapter with no
 * entry of its own is covered by the LAST entry at or before it in spine
 * order (a toc entry often fronts several spine files); a book with no
 * matching label at all falls back to "Chapter N".
 */
export function chapterTitles(
  toc: TocLike[],
  chapterCount: number,
  indexOfPath: (path: string) => number,
): string[] {
  const flat: { label: string; spine: number }[] = [];
  const walk = (entries: TocLike[]): void => {
    for (const entry of entries) {
      const spine = indexOfPath(entry.path);
      if (spine >= 0 && entry.label) flat.push({ label: entry.label, spine });
      walk(entry.children);
    }
  };
  walk(toc);

  const titles: string[] = [];
  for (let i = 0; i < chapterCount; i++) {
    const exact = flat.find((f) => f.spine === i);
    // "Last before it" means last in SPINE order, not last in TOC walk order.
    // A toc that lists its front matter out of order — a trailing "Copyright"
    // pointing back at spine 1 — would otherwise name every later untitled
    // chapter after it.
    let covering: { label: string; spine: number } | undefined;
    for (const f of flat) {
      // `>=` and not `>`: ties keep the LAST entry at that spine, which is how
      // a same-file subsection ("Deep in two") goes on covering the files that
      // follow it.
      if (f.spine <= i && (!covering || f.spine >= covering.spine)) covering = f;
    }
    titles.push(exact?.label ?? covering?.label ?? `Chapter ${i + 1}`);
  }
  return titles;
}

// --- pure: the Logseq outline ---

export interface OutlineItem {
  text: string;
  chapterTitle: string;
  link: string;
  note?: string;
}

// The export is the integration surface with the owner's graph, and files are
// the contract: what leaves here is read back as syntax by another program. A
// book quoting `[[Moby Dick]]` must not mint a page on import; `*hurried*`
// must keep its asterisks; a note the reader typed on two lines must stay one
// block instead of splitting the outline in half from there down.

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

const FILTER_LABELS: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  pink: 'Pink',
  blue: 'Blue',
  orange: 'Orange',
};

export interface NotebookDeps {
  highlights(): Highlight[];
  chapterTitle(chapter: number): string;
  jumpTo(hl: Highlight): void;
  /** The export file, already formatted (name + markdown content). */
  exportFile(): { name: string; content: string };
  /** Called when the panel opens (the shell closes sibling panels here). */
  onOpen?(): void;
}

export interface Notebook {
  isOpen(): boolean;
  close(): void;
}

export function createNotebook(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  deps: NotebookDeps,
): Notebook {
  let filter: HighlightColor | 'all' = 'all';

  const header = document.createElement('div');
  header.className = 'nb-header';
  const heading = document.createElement('span');
  heading.className = 'nb-heading';
  heading.textContent = 'Notebook';
  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.id = 'notebook-export';
  exportBtn.textContent = 'Export';
  exportBtn.setAttribute('aria-label', 'Export highlights as a Logseq outline');
  exportBtn.onclick = (): void => {
    const file = deps.exportFile();
    triggerDownload(file.name, file.content);
  };
  header.append(heading, exportBtn);

  const chips = document.createElement('div');
  chips.className = 'nb-chips';
  const chipButtons: HTMLButtonElement[] = [];
  const chip = (value: HighlightColor | 'all', label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = value === 'all' ? 'nb-chip' : `nb-chip nb-chip-${value}`;
    b.dataset.filter = value;
    b.textContent = label;
    b.onclick = (): void => {
      filter = value;
      render();
    };
    chipButtons.push(b);
    return b;
  };
  chips.append(chip('all', 'All'), ...HIGHLIGHT_COLORS.map((c) => chip(c, FILTER_LABELS[c])));

  const list = document.createElement('div');
  list.className = 'nb-list';
  panel.replaceChildren(header, chips, list);

  function render(): void {
    for (const b of chipButtons) {
      b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    }
    const rows = sortHighlights(deps.highlights()).filter(
      (hl) => filter === 'all' || (hl.color ?? 'yellow') === filter,
    );
    list.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'nb-empty muted';
      empty.textContent = 'Nothing highlighted yet.';
      list.appendChild(empty);
      return;
    }
    for (const hl of rows) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'nb-row';
      row.dataset.hl = hl.id;
      const dot = document.createElement('span');
      dot.className = `nb-dot hl-dot-${hl.color ?? 'yellow'}`;
      const main = document.createElement('span');
      main.className = 'nb-main';
      const text = document.createElement('span');
      text.className = 'nb-text';
      text.textContent = hl.text;
      main.appendChild(text);
      if (hl.note) {
        const note = document.createElement('span');
        note.className = 'nb-note';
        note.textContent = hl.note;
        main.appendChild(note);
      }
      const chapter = document.createElement('span');
      chapter.className = 'nb-chapter muted';
      chapter.textContent = deps.chapterTitle(hl.chapter);
      main.appendChild(chapter);
      row.append(dot, main);
      row.onclick = (): void => {
        close();
        deps.jumpTo(hl);
      };
      list.appendChild(row);
    }
  }

  const open = (): void => {
    if (!panel.hidden) return;
    deps.onOpen?.();
    render();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };

  const close = (): void => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };

  // onclick assignment, not addEventListener: static chrome, reused across
  // opens; handlers must not stack.
  toggle.onclick = (): void => {
    if (panel.hidden) open();
    else close();
  };

  return { isOpen: (): boolean => !panel.hidden, close };
}

function triggerDownload(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
