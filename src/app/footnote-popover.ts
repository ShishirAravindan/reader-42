// The footnote popover (parity H2): tapping a note reference shows the note
// over the page, without moving the reading position. A "Go to note" action
// performs the real jump for readers who want the note in context — and the
// jump-back pill then covers the return.
//
// The note's markup is CLONED and sanitized, never moved: the chapter's DOM
// must stay exactly as the locators saw it (a moved node would shift every
// structural path after it). Backref links inside the note are dropped —
// they lead back to a page the reader never left.

import { sanitizeContent } from '../reader/render.ts';

const EDGE_PAD = 8;

export interface FootnotePopover {
  show(anchor: DOMRect, note: Element, goToNote: () => void): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createFootnotePopover(
  popover: HTMLElement,
  body: HTMLElement,
  gotoButton: HTMLButtonElement,
  reader: HTMLElement,
): FootnotePopover {
  let jump: (() => void) | null = null;

  const close = (): void => {
    if (popover.hidden) return;
    popover.hidden = true;
    body.replaceChildren();
    jump = null;
    document.removeEventListener('click', onDocClick, true);
  };

  // Outside tap dismisses AND is swallowed in the capture phase, so it can
  // never double as a page turn or a chrome toggle (the aa-panel pattern).
  function onDocClick(event: MouseEvent): void {
    if (event.composedPath().includes(popover)) return;
    event.stopPropagation();
    event.preventDefault();
    close();
  }

  gotoButton.onclick = (): void => {
    const run = jump;
    close();
    run?.();
  };

  // Written as custom properties, not as inline left/top: the phone stylesheet
  // makes this a bottom sheet, and a media query cannot beat an inline style.
  function position(anchor: DOMRect): void {
    const rect = reader.getBoundingClientRect();
    const w = popover.offsetWidth;
    const h = popover.offsetHeight;
    let x = anchor.left + anchor.width / 2 - w / 2 - rect.left;
    x = Math.min(Math.max(x, EDGE_PAD), Math.max(rect.width - w - EDGE_PAD, EDGE_PAD));
    let y = anchor.bottom - rect.top + 10;
    if (y + h > rect.height - EDGE_PAD) y = anchor.top - rect.top - h - 10;
    y = Math.min(Math.max(y, EDGE_PAD), Math.max(rect.height - h - EDGE_PAD, EDGE_PAD));
    popover.style.setProperty('--fn-x', `${x}px`);
    popover.style.setProperty('--fn-y', `${y}px`);
  }

  return {
    show(anchor: DOMRect, note: Element, goToNote: () => void): void {
      const clone = note.cloneNode(true) as Element;
      sanitizeContent(clone);
      // Ids would collide with the app's own; backrefs point at the page the
      // reader is already looking at.
      for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
        el.removeAttribute('id');
      }
      for (const a of Array.from(clone.querySelectorAll('a[href^="#"]'))) a.remove();
      body.replaceChildren(clone);
      jump = goToNote;
      popover.style.visibility = 'hidden';
      popover.hidden = false;
      position(anchor);
      popover.style.visibility = '';
      document.addEventListener('click', onDocClick, true);
    },
    close,
    isOpen: (): boolean => !popover.hidden,
    dispose(): void {
      close();
      document.removeEventListener('click', onDocClick, true);
    },
  };
}
