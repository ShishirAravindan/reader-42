// The end-of-book nudge (parity B6): one more forward turn on the last page
// offers the finished state. Never re-nudges a finished book; never forces an
// exit — the reader stays in the book either way.
//
// It behaves like the panels (isOpen/show/close) so the Escape chain can treat
// it as just another dismissible, ahead of them: it is the nearest thing to
// the reader's attention when it is up.

import { el } from './dom.ts';

/** How long the quiet confirmation sits before the card slips away. */
const CONFIRM_MS = 1400;

export interface FinishNudgeDeps {
  /** The open book, or null; a finished book is never nudged again. */
  book(): { title: string; finished: boolean } | null;
  /** Record the finished state (the shell owns the sidecar and its save). */
  markFinished(): void;
}

export interface FinishNudge {
  isOpen(): boolean;
  show(): void;
  close(): void;
}

export function createFinishNudge(deps: FinishNudgeDeps): FinishNudge {
  const card = el<HTMLElement>('finish-nudge');
  card.hidden = true; // a previous open may have left it up

  const close = (): void => {
    card.hidden = true;
  };

  el<HTMLButtonElement>('finish-not-yet').onclick = close;
  el<HTMLButtonElement>('finish-yes').onclick = (): void => {
    if (!deps.book()) return;
    deps.markFinished();
    // A quiet confirmation, then the card slips away.
    el<HTMLElement>('finish-actions').hidden = true;
    el<HTMLElement>('finish-confirm').hidden = false;
    setTimeout(close, CONFIRM_MS);
  };

  return {
    isOpen: (): boolean => !card.hidden,
    show(): void {
      const book = deps.book();
      if (!book || book.finished) return;
      el<HTMLElement>('finish-book-title').textContent = book.title;
      el<HTMLElement>('finish-actions').hidden = false;
      el<HTMLElement>('finish-confirm').hidden = true;
      card.hidden = false;
    },
    close,
  };
}
