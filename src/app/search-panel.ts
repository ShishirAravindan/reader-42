// In-book search UI (parity H5): a query box and a result list grouped by
// chapter, with the words surrounding every hit so a result is recognizable
// before you jump to it.
//
// The panel owns no navigation and no DOM marking: it turns keystrokes into a
// query, renders what the search module found, and hands a chosen hit to the
// shell. That split is why the marking rules (which chapter carries marks,
// when they clear) live in one place rather than spread across the UI.

import type { SearchHit, SearchResults } from '../reader/search.ts';
import { EMPTY_RESULTS } from '../reader/search.ts';

/** Typing settles before the book is scanned; a keystroke is not a query. */
const QUERY_DEBOUNCE_MS = 250;

export interface SearchPanelDeps {
  search(query: string): SearchResults;
  chapterTitle(chapter: number): string;
  /** Take the reader to a hit; the shell marks, reveals, and flashes it. */
  jumpTo(hit: SearchHit, index: number): void;
  /** The box was emptied or the panel explicitly closed: drop the marks. */
  onCleared(): void;
  /** Called when the panel opens; the shell closes sibling panels here. */
  onOpen?(): void;
}

export interface SearchPanel {
  isOpen(): boolean;
  open(prefill?: string): void;
  /** Marks survive a jump (`keepMarks`); an explicit close drops them. */
  close(options?: { keepMarks?: boolean }): void;
  hits(): SearchHit[];
}

/** Plural-aware hit count, honest about a capped list. */
export function hitSummary(results: SearchResults, query: string): string {
  if (query.trim().length === 0) return '';
  const n = results.hits.length;
  if (n === 0) return 'No matches.';
  const noun = n === 1 ? 'match' : 'matches';
  return results.capped ? `First ${n} ${noun}` : `${n} ${noun}`;
}

export function createSearchPanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  deps: SearchPanelDeps,
): SearchPanel {
  const form = document.createElement('form');
  form.className = 'search-form';
  const input = document.createElement('input');
  input.id = 'search-input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.placeholder = 'Search in book';
  input.setAttribute('aria-label', 'Search in book');
  form.append(input);

  const summary = document.createElement('p');
  summary.className = 'search-summary muted';
  summary.id = 'search-summary';

  const list = document.createElement('div');
  list.className = 'search-results';
  list.id = 'search-results';

  panel.replaceChildren(form, summary, list);

  let results: SearchResults = EMPTY_RESULTS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function renderResults(): void {
    list.replaceChildren();
    let openChapter = -1;
    for (const [index, hit] of results.hits.entries()) {
      if (hit.chapter !== openChapter) {
        openChapter = hit.chapter;
        const heading = document.createElement('span');
        heading.className = 'search-chapter';
        heading.textContent = deps.chapterTitle(hit.chapter);
        list.appendChild(heading);
      }

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-hit';
      row.dataset.hit = String(index);
      // Three spans, not markup in a string: the snippet is book text, and
      // book text never becomes HTML anywhere in this reader.
      const before = document.createElement('span');
      before.textContent = hit.before;
      const match = document.createElement('strong');
      match.textContent = hit.match;
      const after = document.createElement('span');
      after.textContent = hit.after;
      row.append(before, match, after);
      row.onclick = (): void => {
        // The panel steps aside but the marks stay: landing on the page with
        // every occurrence lit is the point of searching.
        close({ keepMarks: true });
        deps.jumpTo(hit, index);
      };
      list.appendChild(row);
    }
  }

  function runQuery(): void {
    const query = input.value;
    results = deps.search(query);
    summary.textContent = hitSummary(results, query);
    if (query.trim().length === 0) deps.onCleared();
    renderResults();
  }

  input.oninput = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(runQuery, QUERY_DEBOUNCE_MS);
  };
  // Enter searches now rather than waiting out the debounce.
  form.onsubmit = (event): void => {
    event.preventDefault();
    if (timer) clearTimeout(timer);
    runQuery();
  };

  function open(prefill?: string): void {
    const wasClosed = panel.hidden;
    if (wasClosed) deps.onOpen?.();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (prefill !== undefined) {
      input.value = prefill;
      if (timer) clearTimeout(timer);
      runQuery();
    } else if (wasClosed && input.value.trim().length === 0) {
      // Opening with an empty box is a fresh start: nothing stale on screen.
      results = EMPTY_RESULTS;
      summary.textContent = '';
      renderResults();
      deps.onCleared();
    }
    input.focus();
    input.select();
  }

  function close(options?: { keepMarks?: boolean }): void {
    if (timer) clearTimeout(timer);
    timer = null;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (!options?.keepMarks) deps.onCleared();
  }

  // onclick assignment, not addEventListener: static chrome reused across
  // opens, so handlers must not stack.
  toggle.onclick = (): void => {
    if (panel.hidden) open();
    else close();
  };

  return {
    isOpen: (): boolean => !panel.hidden,
    open,
    close,
    hits: (): SearchHit[] => results.hits,
  };
}
