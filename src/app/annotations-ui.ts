// The annotation layer's chrome-independent overlays (parity E2, F1–F3):
// select text → a floating menu (four highlight colors, Note, Look up, Copy);
// tap an existing mark → the same menu in edit mode (recolor, edit note, copy
// deep link, delete); a small note editor sheet. All overlays dismiss on
// outside tap (swallowed — the dismissing tap never turns a page) or Escape,
// and re-application of a chapter's highlights from the sidecar lives here.
//
// Persistence goes through the sidecar callbacks the shell provides; this
// module never talks to storage directly.

import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../library/types.ts';
import {
  applyHighlight,
  flashHighlight,
  highlightMarks,
  removeHighlight,
  resolveBoundaries,
  serializeRange,
} from '../reader/annotate.ts';
import type { RenderedChapter } from '../reader/render.ts';
import { readerSelection } from '../reader/selection.ts';
import { el } from './dom.ts';

/** Menu opens only after the selection settles; taps evaluate immediately. */
const SELECTION_DEBOUNCE_MS = 250;
const EDGE_PAD = 8;

export interface AnnotationsDeps {
  /** The positioning context (#reader) the overlays live in. */
  reader: HTMLElement;
  viewport: HTMLElement;
  current(): RenderedChapter | null;
  chapterIndex(): number;
  highlights(): Highlight[];
  /** Replace the sidecar's highlight set and persist it. */
  setHighlights(next: Highlight[]): void;
  /** Open the dictionary card for a word or short phrase. */
  lookup(text: string): void;
  /** Open in-book search with the selected text as the query (parity E2). */
  searchInBook(text: string): void;
  /** Absolute deep-link URL for a highlight. */
  linkFor(id: string): string;
  now?(): string;
}

export interface AnnotationsUI {
  /** Re-apply the current chapter's highlights (chapter render, deep links). */
  applyChapter(): void;
  /** Jump-and-flash a highlight in the already-rendered current chapter. */
  reveal(id: string): void;
  /** True while the menu or the note editor is open (page-turn keys pause). */
  isOpen(): boolean;
  /** Escape chain: close the topmost annotation overlay; true when consumed. */
  handleEscape(): boolean;
  dispose(): void;
}

type NoteContext =
  | { mode: 'create'; pending: NonNullable<ReturnType<typeof serializeRange>> }
  | { mode: 'edit'; id: string };

export function createAnnotationsUI(deps: AnnotationsDeps): AnnotationsUI {
  const now = deps.now ?? ((): string => new Date().toISOString());
  const menu = el<HTMLElement>('selection-menu');
  const editor = el<HTMLElement>('note-editor');
  /** The sheet itself; #note-editor around it is only the positioning frame. */
  const noteCard = editor.querySelector('.note-card');
  const noteText = el<HTMLTextAreaElement>('note-text');
  let menuMode: 'create' | 'edit' | null = null;
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the note editor is editing; null while it is closed. */
  let noteContext: NoteContext | null = null;

  const shadow = (): ShadowRoot | null => deps.current()?.shadow ?? null;
  const wrapper = (): HTMLElement | null => deps.current()?.wrapper ?? null;

  const record = (id: string): Highlight | null =>
    deps.highlights().find((h) => h.id === id) ?? null;

  const clearBookSelection = (): void => {
    const root = shadow();
    const selection =
      (root as (ShadowRoot & { getSelection?(): Selection | null }) | null)?.getSelection?.() ??
      document.getSelection();
    try {
      selection?.removeAllRanges();
    } catch {
      // Nothing to clear.
    }
  };

  // --- overlay open/close plumbing ---

  // While any overlay is open, a tap outside it dismisses AND is swallowed in
  // the capture phase, so the dismissing tap can never double as a page turn
  // or chrome toggle (the aa-panel pattern).
  const onDocClick = (event: MouseEvent): void => {
    const path = event.composedPath();
    if (!menu.hidden && path.includes(menu)) return;
    // The CARD, not #note-editor: the editor is the positioning wrapper and
    // spans the full width of the reader, so testing it treated a tap on the
    // backdrop beside the card as a tap inside it, and nothing dismissed.
    if (!editor.hidden && noteCard && path.includes(noteCard)) return;
    event.stopPropagation();
    event.preventDefault();
    closeMenu();
    closeEditor();
  };

  const syncCapture = (): void => {
    if (!menu.hidden || !editor.hidden) {
      document.addEventListener('click', onDocClick, true);
    } else {
      document.removeEventListener('click', onDocClick, true);
    }
  };

  const closeMenu = (): void => {
    menu.hidden = true;
    menuMode = null;
    syncCapture();
  };

  const closeEditor = (): void => {
    editor.hidden = true;
    noteContext = null;
    syncCapture();
  };

  // --- the floating menu ---

  function positionMenu(anchor: DOMRect): void {
    const readerRect = deps.reader.getBoundingClientRect();
    menu.style.visibility = 'hidden';
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    let x = anchor.left + anchor.width / 2 - w / 2 - readerRect.left;
    x = Math.min(Math.max(x, EDGE_PAD), Math.max(readerRect.width - w - EDGE_PAD, EDGE_PAD));
    let y = anchor.top - readerRect.top - h - 10;
    if (y < EDGE_PAD) y = anchor.bottom - readerRect.top + 10;
    y = Math.min(Math.max(y, EDGE_PAD), Math.max(readerRect.height - h - EDGE_PAD, EDGE_PAD));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = '';
    syncCapture();
  }

  const action = (id: string, label: string, run: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.textContent = label;
    b.onclick = run;
    return b;
  };

  function colorDots(
    mode: 'create' | 'edit',
    current: HighlightColor | null,
    pick: (color: HighlightColor) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sel-colors';
    for (const color of HIGHLIGHT_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hl-dot hl-dot-${color}`;
      b.dataset.color = color;
      b.setAttribute(
        'aria-label',
        mode === 'create' ? `Highlight in ${color}` : `Recolor to ${color}`,
      );
      b.setAttribute('aria-pressed', String(current === color));
      b.onclick = (): void => pick(color);
      row.appendChild(b);
    }
    return row;
  }

  function openCreateMenu(range: Range): void {
    const root = wrapper();
    if (!root) return;
    const serialized = serializeRange(root, range);
    if (!serialized) return;
    const anchor = range.getBoundingClientRect();
    menuMode = 'create';

    menu.replaceChildren(
      colorDots('create', null, (color) => createHighlight(serialized, color)),
      (() => {
        const row = document.createElement('div');
        row.className = 'sel-actions';
        row.append(
          action('sel-note', 'Note', () => openEditor({ mode: 'create', pending: serialized })),
          action('sel-lookup', 'Look up', () => {
            closeMenu();
            deps.lookup(serialized.text);
          }),
          action('sel-search', 'Search', () => {
            closeMenu();
            clearBookSelection();
            deps.searchInBook(serialized.text);
          }),
          action('sel-copy', 'Copy', () => {
            void navigator.clipboard?.writeText(serialized.text);
            closeMenu();
            clearBookSelection();
          }),
        );
        return row;
      })(),
    );
    positionMenu(anchor);
  }

  function openEditMenu(id: string, anchor: DOMRect): void {
    const existing = record(id);
    if (!existing) return;
    menuMode = 'edit';
    menu.replaceChildren(
      colorDots('edit', existing.color ?? 'yellow', (color) => recolor(id, color)),
      (() => {
        const row = document.createElement('div');
        row.className = 'sel-actions';
        row.append(
          action('sel-note', existing.note ? 'Edit note' : 'Note', () =>
            openEditor({ mode: 'edit', id }),
          ),
          action('sel-copy-link', 'Copy link', () => {
            void navigator.clipboard?.writeText(deps.linkFor(id));
            closeMenu();
          }),
          action('sel-delete', 'Delete', () => deleteHighlight(id)),
        );
        return row;
      })(),
    );
    positionMenu(anchor);
  }

  // --- highlight operations ---

  function randomId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function createHighlight(
    serialized: NonNullable<ReturnType<typeof serializeRange>>,
    color: HighlightColor,
    note?: string,
  ): void {
    const root = wrapper();
    if (!root) return;
    const hl: Highlight = {
      id: randomId(),
      chapter: deps.chapterIndex(),
      start: serialized.start,
      end: serialized.end,
      text: serialized.text,
      color,
      ...(note ? { note } : {}),
      createdAt: now(),
    };
    deps.setHighlights([...deps.highlights(), hl]);
    const range = resolveBoundaries(root, hl.start, hl.end);
    if (range) applyHighlight(root, { id: hl.id, color, ...(note ? { note } : {}) }, range);
    closeMenu();
    clearBookSelection();
  }

  function recolor(id: string, color: HighlightColor): void {
    deps.setHighlights(
      deps.highlights().map((h) => (h.id === id ? { ...h, color, editedAt: now() } : h)),
    );
    const root = wrapper();
    if (root) {
      for (const mark of highlightMarks(root, id)) {
        for (const c of HIGHLIGHT_COLORS) mark.classList.remove(`hl-${c}`);
        mark.classList.add(`hl-${color}`);
      }
    }
    closeMenu();
  }

  function deleteHighlight(id: string): void {
    deps.setHighlights(deps.highlights().filter((h) => h.id !== id));
    const root = wrapper();
    if (root) removeHighlight(root, id);
    closeMenu();
  }

  function setNote(id: string, note: string): void {
    const trimmed = note.trim();
    deps.setHighlights(
      deps.highlights().map((h) => {
        if (h.id !== id) return h;
        const { note: _oldNote, ...rest } = h;
        return { ...rest, ...(trimmed ? { note: trimmed } : {}), editedAt: now() };
      }),
    );
    // Refresh the marker glyph by re-marking this highlight from its record.
    const root = wrapper();
    const hl = record(id);
    if (!root || !hl) return;
    removeHighlight(root, id);
    const range = resolveBoundaries(root, hl.start, hl.end);
    if (range) {
      applyHighlight(
        root,
        { id, color: hl.color ?? 'yellow', ...(trimmed ? { note: trimmed } : {}) },
        range,
      );
    }
  }

  // --- the note editor sheet ---

  function openEditor(context: NoteContext): void {
    closeMenu();
    noteContext = context;
    noteText.value = context.mode === 'edit' ? (record(context.id)?.note ?? '') : '';
    editor.hidden = false;
    syncCapture();
    noteText.focus();
  }

  el<HTMLButtonElement>('note-cancel').onclick = (): void => closeEditor();
  el<HTMLButtonElement>('note-save').onclick = (): void => {
    const context = noteContext;
    if (!context) return;
    if (context.mode === 'create') {
      createHighlight(context.pending, 'yellow', noteText.value.trim() || undefined);
    } else {
      setNote(context.id, noteText.value);
    }
    closeEditor();
  };

  // Keep the book selection visible while a MOUSE clicks a menu button: the
  // mousedown would otherwise collapse it under the reader's own cursor.
  //
  // Touch gets no preventDefault, ever. Cancelling a touchstart suppresses the
  // compatibility mouse events the buttons are wired on, so every control here
  // — the colour dots, Note, Look up, Copy — was inert on a phone. Nothing is
  // lost by letting the touch through: openCreateMenu captured `serialized`
  // when the menu was built, and evaluateSelection is 250ms behind the tap.
  const onMenuPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') event.preventDefault();
  };
  menu.addEventListener('pointerdown', onMenuPointerDown);

  // --- selection and mark-tap watching ---

  const evaluateSelection = (): void => {
    const root = shadow();
    if (!root) return;
    const range = readerSelection(root);
    if (range) {
      if (editor.hidden) openCreateMenu(range);
      return;
    }
    // The selection is gone. Close a create-mode menu that lost its anchor;
    // the capture-phase swallow above handles tap dismissals first, and edit
    // menus never depend on a selection.
    if (!menu.hidden && menuMode === 'create') closeMenu();
  };

  const onSelectionChange = (): void => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(evaluateSelection, SELECTION_DEBOUNCE_MS);
  };

  const onPointerUp = (event: PointerEvent): void => {
    // Pointerups on the overlays themselves must not rebuild the menu out
    // from under their own click.
    const path = event.composedPath();
    if (path.includes(menu) || path.includes(editor)) return;
    if (selectionTimer) clearTimeout(selectionTimer);
    // Selection state settles right after pointerup; evaluate on the next tick.
    selectionTimer = setTimeout(evaluateSelection, 0);
  };

  const onViewportClick = (event: MouseEvent): void => {
    const mark = event
      .composedPath()
      .find(
        (n): n is HTMLElement =>
          n instanceof Element && n.tagName === 'MARK' && n.classList.contains('hl'),
      );
    if (!mark) return;
    const id = mark.dataset.hl;
    const root = shadow();
    if (!id || (root && readerSelection(root))) return; // an active selection wins
    openEditMenu(id, mark.getBoundingClientRect());
  };

  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('pointerup', onPointerUp);
  deps.viewport.addEventListener('click', onViewportClick);

  return {
    applyChapter(): void {
      const view = deps.current();
      if (!view) return;
      const chapter = deps.chapterIndex();
      for (const hl of deps.highlights()) {
        if (hl.chapter !== chapter) continue;
        if (highlightMarks(view.wrapper, hl.id).length > 0) continue; // already marked
        const range = resolveBoundaries(view.wrapper, hl.start, hl.end);
        if (!range) continue; // stale: silently not rendered, never a crash
        applyHighlight(
          view.wrapper,
          { id: hl.id, color: hl.color ?? 'yellow', ...(hl.note ? { note: hl.note } : {}) },
          range,
        );
      }
    },
    reveal(id: string): void {
      const view = deps.current();
      if (!view) return;
      const mark = highlightMarks(view.wrapper, id)[0];
      if (!mark) return;
      view.revealElement(mark);
      flashHighlight(view.wrapper, id);
    },
    isOpen: (): boolean => !menu.hidden || !editor.hidden,
    handleEscape(): boolean {
      if (!menu.hidden) {
        closeMenu();
        return true;
      }
      if (!editor.hidden) {
        closeEditor();
        return true;
      }
      return false;
    },
    dispose(): void {
      if (selectionTimer) clearTimeout(selectionTimer);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('click', onDocClick, true);
      deps.viewport.removeEventListener('click', onViewportClick);
      menu.removeEventListener('pointerdown', onMenuPointerDown);
      menu.hidden = true;
      editor.hidden = true;
    },
  };
}
