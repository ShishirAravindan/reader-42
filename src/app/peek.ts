// Page Flip (parity H4): look anywhere in the book without losing your place.
//
// Kindle's peek is a position slider with a hovering page preview and a 3×3
// thumbnail grid. Thumbnails need every page of the book laid out at once,
// which the rendering unit deliberately does not do (see the kindle-parity
// kickoff resolutions), so the preview is the honest equivalent: the location
// you are scrubbing to, its chapter, and the words that are actually there.
// It is all derived from character metrics, so previewing renders nothing and
// — the whole point — never moves the reading position.
//
// The peek confirms explicitly. Releasing the thumb previews; "Go" jumps; the
// chip returns to where you started; closing does nothing at all.

import { LOCATION_SPAN } from '../reader/metrics.ts';

export interface PeekPreview {
  location: number;
  chapterTitle: string;
  excerpt: string;
}

/**
 * The location each chapter starts at, skipping chapters with no text so a
 * chapter-skip never lands on an empty one. Index i is chapter i's start;
 * empty chapters share their successor's start and are filtered by the skip.
 */
export function chapterStartLocations(chapterChars: number[]): number[] {
  const starts: number[] = [];
  let before = 0;
  for (const chars of chapterChars) {
    starts.push(Math.floor(before / LOCATION_SPAN) + 1);
    before += chars;
  }
  return starts;
}

/**
 * The next chapter start strictly after `location` (or the previous one
 * strictly before it), or null at the ends. Empty chapters are skipped: they
 * are not places a reader can be.
 */
export function chapterSkip(
  chapterChars: number[],
  location: number,
  direction: 'next' | 'prev',
): number | null {
  const starts = chapterStartLocations(chapterChars);
  const real = starts.filter((_, i) => (chapterChars[i] ?? 0) > 0);
  if (direction === 'next') return real.find((s) => s > location) ?? null;
  return [...real].reverse().find((s) => s < location) ?? null;
}

export interface PeekDeps {
  /** Where the reader is now, as a location number. */
  currentLocation(): number;
  totalLocations(): number;
  chapterChars(): number[];
  /** The words at a location, with the chapter they belong to. */
  preview(location: number): PeekPreview;
  /** Confirmed: take the reader there (the shell records the way back). */
  goTo(location: number): void;
  /** Called when the peek opens; the shell closes panels and chrome here. */
  onOpen?(): void;
}

export interface Peek {
  isOpen(): boolean;
  open(): void;
  close(): void;
}

export function createPeek(sheet: HTMLElement, deps: PeekDeps): Peek {
  const preview = document.createElement('div');
  preview.className = 'peek-preview';
  const locLabel = document.createElement('span');
  locLabel.className = 'peek-loc';
  locLabel.id = 'peek-loc';
  const chapterLabel = document.createElement('span');
  chapterLabel.className = 'peek-chapter muted';
  chapterLabel.id = 'peek-chapter';
  const excerpt = document.createElement('p');
  excerpt.className = 'peek-excerpt';
  excerpt.id = 'peek-excerpt';
  preview.append(locLabel, chapterLabel, excerpt);

  const controls = document.createElement('div');
  controls.className = 'peek-controls';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.id = 'peek-prev';
  prev.textContent = '‹';
  prev.setAttribute('aria-label', 'Previous chapter');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'peek-slider';
  slider.min = '1';
  slider.step = '1';
  slider.setAttribute('aria-label', 'Location in book');
  const next = document.createElement('button');
  next.type = 'button';
  next.id = 'peek-next';
  next.textContent = '›';
  next.setAttribute('aria-label', 'Next chapter');
  controls.append(prev, slider, next);

  const actions = document.createElement('div');
  actions.className = 'peek-actions';
  const back = document.createElement('button');
  back.type = 'button';
  back.id = 'peek-back';
  const go = document.createElement('button');
  go.type = 'button';
  go.id = 'peek-go';
  go.textContent = 'Go';
  actions.append(back, go);

  sheet.replaceChildren(preview, controls, actions);

  /** The location the peek was opened from; what the chip returns to. */
  let origin = 1;

  const value = (): number => Number(slider.value);

  function render(): void {
    const shown = deps.preview(value());
    locLabel.textContent = `Loc ${shown.location.toLocaleString('en-US')}`;
    chapterLabel.textContent = shown.chapterTitle;
    excerpt.textContent = shown.excerpt;
    const chars = deps.chapterChars();
    prev.disabled = chapterSkip(chars, value(), 'prev') === null;
    next.disabled = chapterSkip(chars, value(), 'next') === null;
    // The chip is the promise that peeking costs nothing.
    back.textContent = `Back to Loc ${origin.toLocaleString('en-US')}`;
  }

  slider.oninput = render;

  const skip = (direction: 'next' | 'prev') => (): void => {
    const target = chapterSkip(deps.chapterChars(), value(), direction);
    if (target === null) return;
    slider.value = String(target);
    render();
  };
  prev.onclick = skip('prev');
  next.onclick = skip('next');

  function open(): void {
    if (!sheet.hidden) return;
    deps.onOpen?.();
    origin = deps.currentLocation();
    slider.max = String(deps.totalLocations());
    slider.value = String(origin);
    render();
    sheet.hidden = false;
    slider.focus();
  }

  function close(): void {
    sheet.hidden = true;
  }

  back.onclick = close; // the position never moved, so returning is just leaving
  go.onclick = (): void => {
    const target = value();
    close();
    if (target !== origin) deps.goTo(target);
  };

  return { isOpen: (): boolean => !sheet.hidden, open, close };
}
