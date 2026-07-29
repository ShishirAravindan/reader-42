// Semantic reading input: tap zones, swipe, and keyboard page turns, mapped
// to 'forward'/'back'/'chrome' so the shell never touches raw geometry.
// Kindle zone model (A3): left third back, right third forward, center
// reveals chrome; everything mirrors for right-to-left books.

export type TurnDirection = 'forward' | 'back';
export type ReadingDirection = 'ltr' | 'rtl';
export type TapZone = 'back' | 'chrome' | 'forward';

/** Swipes shorter than this, or more vertical than horizontal, are not turns. */
export const SWIPE_MIN_PX = 44;

export function zoneFor(x: number, width: number, dir: ReadingDirection): TapZone {
  if (width <= 0) return 'chrome';
  const fraction = x / width;
  if (fraction >= 0.33 && fraction <= 0.66) return 'chrome';
  const right = fraction > 0.66;
  return right === (dir === 'ltr') ? 'forward' : 'back';
}

export function turnForKey(
  key: string,
  shiftKey: boolean,
  dir: ReadingDirection,
): TurnDirection | null {
  switch (key) {
    case ' ':
    case 'Spacebar':
      return shiftKey ? 'back' : 'forward';
    case 'PageDown':
      return 'forward';
    case 'PageUp':
      return 'back';
    case 'ArrowRight':
      return dir === 'ltr' ? 'forward' : 'back';
    case 'ArrowLeft':
      return dir === 'ltr' ? 'back' : 'forward';
    default:
      return null;
  }
}

/** Swipe left advances in LTR (the page "pushes" left), mirrored for RTL. */
export function swipeTurn(dx: number, dy: number, dir: ReadingDirection): TurnDirection | null {
  if (Math.abs(dx) <= SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return null;
  const left = dx < 0;
  return left === (dir === 'ltr') ? 'forward' : 'back';
}

export interface ReadingInputOptions {
  dir(): ReadingDirection;
  onTurn(d: TurnDirection): void;
  onChrome(): void;
  /** Gate for document-level keys (e.g. false while the reader is hidden). */
  keysEnabled?(): boolean;
}

/** Wire tap zones, swipe, and keys to a viewport. Returns a detach function. */
export function attachReadingInput(viewport: HTMLElement, opts: ReadingInputOptions): () => void {
  // A handled swipe also dispatches a click at the touch point; without this
  // flag one gesture would both swipe-turn and zone-turn.
  let suppressClick = false;
  let touchStart: { x: number; y: number } | null = null;

  const onClick = (event: MouseEvent): void => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // Links navigate; the internal-link handler owns them. Highlight marks
    // belong to the annotation layer: tapping one opens its menu, never turns.
    for (const node of event.composedPath()) {
      if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) return;
      if (node instanceof Element && node.tagName === 'MARK' && node.classList.contains('hl')) {
        return;
      }
    }
    if (hasSelection(event)) return;
    const rect = viewport.getBoundingClientRect();
    const zone = zoneFor(event.clientX - rect.left, rect.width, opts.dir());
    if (zone === 'chrome') opts.onChrome();
    else opts.onTurn(zone);
  };

  const onTouchStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    touchStart =
      touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onTouchEnd = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (!touchStart || !touch) return;
    const turn = swipeTurn(touch.clientX - touchStart.x, touch.clientY - touchStart.y, opts.dir());
    touchStart = null;
    if (!turn) return;
    suppressClick = true;
    opts.onTurn(turn);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (opts.keysEnabled && !opts.keysEnabled()) return;
    if (isEditable(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const turn = turnForKey(event.key, event.shiftKey, opts.dir());
    if (!turn) return;
    event.preventDefault();
    opts.onTurn(turn);
  };

  viewport.addEventListener('click', onClick);
  viewport.addEventListener('touchstart', onTouchStart, { passive: true });
  viewport.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('keydown', onKeyDown);
  return (): void => {
    viewport.removeEventListener('click', onClick);
    viewport.removeEventListener('touchstart', onTouchStart);
    viewport.removeEventListener('touchend', onTouchEnd);
    document.removeEventListener('keydown', onKeyDown);
  };
}

/** A tap that ends a text selection must not also turn the page. */
function hasSelection(event: MouseEvent): boolean {
  // Chromium exposes shadow selections on the shadow root (salvage §1).
  const root = (event.composedPath()[0] as Node | undefined)?.getRootNode?.();
  const shadowSelection =
    root instanceof ShadowRoot && 'getSelection' in root
      ? (root as unknown as { getSelection(): Selection | null }).getSelection()
      : null;
  const selection = shadowSelection ?? document.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().length > 0;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
}
