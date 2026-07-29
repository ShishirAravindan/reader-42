// Auto-hiding reading chrome: the top and bottom bars overlay the viewport
// (never reflow it — a reflow would re-paginate), toggled by a class on the
// reader section. The conservative rules (salvage §4, parity I1): a book
// opens with chrome hidden, straight into text; a center tap toggles; a page
// turn hides; Escape only ever restores or closes, never hides. The Escape
// and tap wiring lives in the shell, which knows about panels.

export interface ReaderChrome {
  reveal(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
}

const HIDDEN_CLASS = 'chrome-hidden';

export function createChrome(root: HTMLElement): ReaderChrome {
  const set = (open: boolean): void => {
    root.classList.toggle(HIDDEN_CLASS, !open);
  };
  return {
    reveal: (): void => set(true),
    hide: (): void => set(false),
    toggle: (): void => set(root.classList.contains(HIDDEN_CLASS)),
    isOpen: (): boolean => !root.classList.contains(HIDDEN_CLASS),
  };
}
