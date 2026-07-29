// The Notebook (parity F4): every highlight and note in the book, in book
// order, filterable by color, each row jumping to its place, plus the Logseq
// export — one markdown outline per book (salvage §5: highlight text, chapter
// title — never spine indices — deep link, optional note).
//
// The pure pieces (ordering, chapter-title mapping, the outline format) live
// at the top and are unit-tested; the panel below mirrors the TOC pattern.

import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../library/types.ts';

// --- pure: book ordering ---

/** Lexicographic compare of structural element paths. */
export function comparePaths(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    if (av === undefined) return -1; // a is the ancestor: it starts first
    if (bv === undefined) return 1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

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
    let covering: { label: string; spine: number } | undefined;
    for (const f of flat) if (f.spine <= i) covering = f;
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

/** One markdown outline per book: `# title`, then a bullet per highlight
 * with chapter title, deep link, and (when present) the note as sub-bullets. */
export function logseqOutline(title: string, items: OutlineItem[]): string {
  const lines = [`# ${title}`];
  for (const item of items) {
    lines.push(`- ${item.text}`);
    lines.push(`  - ${item.chapterTitle}`);
    lines.push(`  - [link](${item.link})`);
    if (item.note) lines.push(`  - note: ${item.note}`);
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
