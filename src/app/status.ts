// The always-visible reading status line (parity B3): a strip at the bottom
// edge of the reader, independent of the auto-hiding chrome. The left slot
// cycles on tap through Kindle's states — time left in chapter, time left in
// book, location, print page (only when the book has a page-list), percent,
// off — the middle is a progress rule, and the right slot shows percent unless
// it would be redundant or the strip is off. Pure formatting and cycle logic
// live here, unit-tested; persistence of the chosen state is the caller's
// (prefs) via callbacks, so this module owns no storage.
//
// The rule's TAP belongs to the shell (it opens the Page Flip peek): this
// module only paints how far along it is, from the same progress the readout
// reads.

import type { PageAnchor } from '../reader/metrics.ts';

export type StatusMode =
  | 'time-left-chapter'
  | 'time-left-book'
  | 'location'
  | 'page'
  | 'percent'
  | 'off';

/** Cycle order; 'page' is skipped for books without a page-list. */
export const STATUS_MODES: readonly StatusMode[] = [
  'time-left-chapter',
  'time-left-book',
  'location',
  'page',
  'percent',
  'off',
];

export function nextStatusMode(mode: StatusMode, hasPages: boolean): StatusMode {
  const order = STATUS_MODES.filter((m) => m !== 'page' || hasPages);
  const next = order[(order.indexOf(mode) + 1) % order.length];
  return next ?? 'time-left-chapter';
}

// --- pure formatting (Kindle tone: no seconds, no decimals) ---

export function formatTimeLeft(minutes: number | null, scope: 'chapter' | 'book'): string {
  if (minutes === null) return 'Learning reading speed…';
  if (minutes < 1) return 'Less than a minute left';
  const where = scope === 'chapter' ? 'in chapter' : 'in book';
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min left ${where}`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m === 0 ? `${h} hr left ${where}` : `${h} hr ${m} min left ${where}`;
}

export function formatLocation(loc: number, total: number): string {
  return `Loc ${loc.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
}

export function formatPage(label: string, last: string): string {
  return `Page ${label} of ${last}`;
}

export function formatPercent(progress: number): string {
  return `${Math.round(clampProgress(progress) * 100)}%`;
}

/** Nothing outside 0..1 is a place in a book; the rule and the percent agree. */
function clampProgress(progress: number): number {
  return Math.min(Math.max(progress, 0), 1);
}

/** The print page containing a global char offset: last anchor at or before it. */
export function pageAt(
  anchors: PageAnchor[],
  globalChar: number,
): { label: string; last: string } | null {
  const first = anchors[0];
  const lastAnchor = anchors[anchors.length - 1];
  if (!first || !lastAnchor) return null;
  let current = first;
  for (const anchor of anchors) {
    if (anchor.globalChar > globalChar) break;
    current = anchor;
  }
  return { label: current.label, last: lastAnchor.label };
}

// --- the strip itself ---

/** Live position feed; every call reads the current state, nothing cached. */
export interface StatusSource {
  progress(): number;
  location(): { loc: number; total: number };
  /** Null when the book carries no page-list; the 'page' state is skipped. */
  page(): { label: string; last: string } | null;
  minutesLeft(scope: 'chapter' | 'book'): number | null;
}

export interface StatusLine {
  refresh(): void;
  mode(): StatusMode;
}

/** The strip's three parts, plus the strip itself (which carries the off state). */
export interface StatusElements {
  strip: HTMLElement;
  /** The cycling readout; also the target that brings the strip back from off. */
  cycle: HTMLButtonElement;
  /** The filled portion of the progress rule; its width IS the progress. */
  progress: HTMLElement;
  /** The percent slot. */
  percent: HTMLElement;
}

const OFF_CLASS = 'status-off';

export function createStatusLine(
  elements: StatusElements,
  source: StatusSource,
  initialMode: StatusMode,
  onModeChange: (mode: StatusMode) => void,
): StatusLine {
  const { strip, cycle: cycleTarget, progress: progressFill, percent: rightSlot } = elements;
  // A stale 'page' pref from a book with a page-list degrades gracefully.
  let mode: StatusMode = initialMode === 'page' && source.page() === null ? 'percent' : initialMode;

  const leftText = (): string => {
    switch (mode) {
      case 'time-left-chapter':
        return formatTimeLeft(source.minutesLeft('chapter'), 'chapter');
      case 'time-left-book':
        return formatTimeLeft(source.minutesLeft('book'), 'book');
      case 'location': {
        const { loc, total } = source.location();
        return formatLocation(loc, total);
      }
      case 'page': {
        const page = source.page();
        return page ? formatPage(page.label, page.last) : '';
      }
      case 'percent':
        return formatPercent(source.progress());
      case 'off':
        return '';
    }
  };

  const render = (): void => {
    strip.classList.toggle(OFF_CLASS, mode === 'off');
    cycleTarget.textContent = leftText();
    const showRight = mode !== 'off' && mode !== 'percent';
    rightSlot.textContent = showRight ? formatPercent(source.progress()) : '';
    // Character-weighted, like every other progress number here: the rule and
    // the percent can never disagree. Tenths of a percent — finer than a pixel
    // on any screen this runs on, and free of binary-float dust.
    const filled = Math.round(clampProgress(source.progress()) * 1000) / 10;
    progressFill.style.setProperty('--progress', `${filled}%`);
  };

  // onclick assignment, not addEventListener: the elements are static app
  // chrome reused across opens, and handlers must not stack.
  cycleTarget.onclick = (event): void => {
    event.stopPropagation(); // never reaches the tap zones: no page turn
    mode = nextStatusMode(mode, source.page() !== null);
    onModeChange(mode);
    render();
  };

  render();
  return { refresh: render, mode: (): StatusMode => mode };
}
