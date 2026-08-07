// The Go To panel (parity H1, with G2's bookmark list folded in): one place
// that answers "take me somewhere in this book". Sections, top to bottom:
//
//   quick     Cover · Beginning · a Page-or-Location box
//   Contents  the book's own TOC, unchanged
//   Bookmarks every marked page, with a snippet of what is there
//
// The panel owns no navigation logic: it resolves what the reader typed into
// a target and hands it to the shell, which owns the controller and the
// jump-back stack. The pure resolution (what does "42" mean?) lives at the
// top and is unit-tested.

import type { TocEntry } from '../epub/types.ts';
import type { Bookmark } from '../library/types.ts';
import type { PageAnchor } from '../reader/metrics.ts';
import { bookmarkDate, sortBookmarks } from './bookmarks.ts';

// --- pure: what did the reader type? ---

export type GoToTarget =
  | { kind: 'page'; label: string; globalChar: number }
  | { kind: 'location'; location: number };

/**
 * Resolve a Page-or-Location box. A book with print pages answers with its
 * own page labels first (Kindle does the same: you type what is printed on
 * the page you are holding); anything else is read as a location number.
 * Null when the entry names nothing in this book.
 */
export function resolveGoTo(
  raw: string,
  pages: PageAnchor[],
  totalLocations: number,
): GoToTarget | null {
  const text = raw.trim();
  if (!text) return null;
  const page = pages.find((p) => p.label.toLowerCase() === text.toLowerCase());
  if (page) return { kind: 'page', label: page.label, globalChar: page.globalChar };
  if (!/^\d+$/.test(text)) return null;
  const location = Number(text);
  if (location < 1 || location > totalLocations) return null;
  return { kind: 'location', location };
}

// --- the panel ---

export interface GoToDeps {
  /** The element the book's own TOC is rendered into. */
  contents: HTMLElement;
  /** The book's TOC, rendered as the Contents section. */
  toc: TocEntry[];
  /** Take the reader to a TOC entry (the shell records the way back). */
  goToTocEntry(entry: TocEntry): void;
  bookmarks(): Bookmark[];
  chapterTitle(chapter: number): string;
  /** A short excerpt of what sits at a bookmark, for its row. */
  snippet(bookmark: Bookmark): string;
  pages(): PageAnchor[];
  totalLocations(): number;
  goToCover(): void;
  goToBeginning(): void;
  goToTarget(target: GoToTarget): void;
  goToBookmark(bookmark: Bookmark): void;
  removeBookmark(bookmark: Bookmark): void;
  /** Called when the panel opens (the shell closes sibling panels here). */
  onOpen?(): void;
}

export interface GoToPanel {
  isOpen(): boolean;
  open(): void;
  close(): void;
  /** Re-render the bookmark list (a bookmark was added or removed elsewhere). */
  refresh(): void;
}

export function createGoToPanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  deps: GoToDeps,
): GoToPanel {
  const quick = document.createElement('div');
  quick.className = 'goto-quick';

  const jump = (id: string, label: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = label;
    b.onclick = (): void => {
      close();
      run();
    };
    return b;
  };

  const entry = document.createElement('form');
  entry.className = 'goto-entry';
  const input = document.createElement('input');
  input.id = 'goto-location';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  const go = document.createElement('button');
  go.type = 'submit';
  go.id = 'goto-location-go';
  go.textContent = 'Go';
  const error = document.createElement('span');
  error.className = 'goto-error muted';
  error.id = 'goto-error';
  entry.append(input, go);

  entry.onsubmit = (event): void => {
    event.preventDefault();
    const target = resolveGoTo(input.value, deps.pages(), deps.totalLocations());
    if (!target) {
      error.textContent = `Nothing at “${input.value.trim()}”.`;
      return;
    }
    error.textContent = '';
    input.value = '';
    close();
    deps.goToTarget(target);
  };

  quick.append(
    jump('goto-cover', 'Cover', deps.goToCover),
    jump('goto-beginning', 'Beginning', deps.goToBeginning),
  );

  const heading = (text: string): HTMLElement => {
    const h = document.createElement('span');
    h.className = 'goto-heading';
    h.textContent = text;
    return h;
  };

  const bookmarkList = document.createElement('div');
  bookmarkList.className = 'goto-bookmarks';
  bookmarkList.id = 'goto-bookmarks';

  panel.replaceChildren(
    quick,
    entry,
    error,
    heading('Contents'),
    deps.contents,
    heading('Bookmarks'),
    bookmarkList,
  );

  function renderBookmarks(): void {
    bookmarkList.replaceChildren();
    const marks = sortBookmarks(deps.bookmarks());
    if (marks.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'goto-empty muted';
      empty.textContent = 'No bookmarks yet. Tap the top-right corner of a page.';
      bookmarkList.appendChild(empty);
      return;
    }
    for (const bm of marks) {
      const row = document.createElement('div');
      row.className = 'goto-bm-row';
      row.dataset.bookmark = bm.id;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'goto-bm-main';
      const chapter = document.createElement('span');
      chapter.className = 'goto-bm-chapter';
      chapter.textContent = deps.chapterTitle(bm.chapter);
      const snippet = document.createElement('span');
      snippet.className = 'goto-bm-snippet';
      snippet.textContent = deps.snippet(bm);
      const date = document.createElement('span');
      date.className = 'goto-bm-date muted';
      date.textContent = bookmarkDate(bm.createdAt);
      main.append(chapter, snippet, date);
      main.onclick = (): void => {
        close();
        deps.goToBookmark(bm);
      };

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'goto-bm-delete';
      remove.setAttribute('aria-label', 'Remove bookmark');
      remove.textContent = '×';
      remove.onclick = (): void => {
        deps.removeBookmark(bm);
        renderBookmarks();
      };

      row.append(main, remove);
      bookmarkList.appendChild(row);
    }
  }

  // The Contents section is the book's own TOC, nested exactly as the file
  // nests it; labels are the book's words, never spine indices.
  function renderToc(root: HTMLElement, entries: TocEntry[]): void {
    root.replaceChildren();
    root.appendChild(tocList(entries));
  }

  function tocList(entries: TocEntry[]): HTMLOListElement {
    const ol = document.createElement('ol');
    for (const entry of entries) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.textContent = entry.label || '(untitled)';
      a.href = '#';
      a.addEventListener('click', (event) => {
        event.preventDefault();
        close();
        deps.goToTocEntry(entry);
      });
      li.appendChild(a);
      if (entry.children.length > 0) li.appendChild(tocList(entry.children));
      ol.appendChild(li);
    }
    return ol;
  }

  const open = (): void => {
    if (!panel.hidden) return;
    deps.onOpen?.();
    error.textContent = '';
    input.value = '';
    const total = deps.totalLocations();
    input.placeholder =
      deps.pages().length > 0 ? `Page or location 1–${total}` : `Location 1–${total}`;
    input.setAttribute('aria-label', input.placeholder);
    renderBookmarks();
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

  renderToc(deps.contents, deps.toc);

  return {
    isOpen: (): boolean => !panel.hidden,
    open,
    close,
    refresh: (): void => {
      if (!panel.hidden) renderBookmarks();
    },
  };
}
