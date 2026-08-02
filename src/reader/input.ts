// Semantic reading input: tap zones, swipe, and keyboard page turns, mapped
// to 'forward'/'back'/'chrome' so the shell never touches raw geometry.
// Kindle zone model (A3): left third back, right third forward, center
// reveals chrome. The pure helpers mirror for right-to-left books; what the
// wiring actually feeds them is inputDirection(), which stays 'ltr' until the
// renderer mirrors too — see the note on it.

export type TurnDirection = 'forward' | 'back';
export type ReadingDirection = 'ltr' | 'rtl';
export type TapZone = 'back' | 'chrome' | 'forward';

/** Swipes shorter than this, or more vertical than horizontal, are not turns. */
export const SWIPE_MIN_PX = 44;

/**
 * The bookmark corner (parity G1): a square at the top-right of the page,
 * Kindle-sized for a thumb. It is carved OUT of the tap zones by the attach
 * layer — zoneFor stays a pure three-zone split — and wins over the forward
 * zone it overlaps, because a corner tap is never a page turn.
 */
export const CORNER_PX = 56;

export function isCornerTap(x: number, y: number, width: number, size = CORNER_PX): boolean {
  if (width <= 0) return false;
  return x >= width - size && x <= width && y >= 0 && y <= size;
}

/**
 * The direction the INPUT model mirrors on, given the book's own page
 * progression. It is always 'ltr', because the renderer does not mirror:
 * `.chapter.paged` has no `direction: rtl` and its CSS columns always run left
 * to right, so in an `<spine page-progression-direction="rtl">` book page 2
 * still renders to the RIGHT of page 1. Mirroring the input alone points every
 * gesture the wrong way against what is on screen: the right third would go
 * back, ArrowRight would go back, a swipe left would go back.
 *
 * Mirroring for real needs the renderer to move first: `direction: rtl` on the
 * chapter wrapper so the columns lay out right to left, the paged scroller's
 * reversed (negative) scrollLeft handled in the page arithmetic, and the page
 * anchors and column-stride maths re-derived against that origin. Until then
 * input matches layout, which is the honest half of the feature. zoneFor,
 * turnForKey and swipeTurn keep their `dir` parameter — they are already
 * correct, and are what the renderer's mirroring will switch back on.
 */
export function inputDirection(_bookDirection: ReadingDirection): ReadingDirection {
  return 'ltr';
}

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

/**
 * The Page Flip gesture (parity H4): a swipe up that STARTS near the bottom
 * edge. Anchoring it to the edge is what keeps it from competing with reading
 * — a swipe anywhere else is a page turn or, in scroll mode, a scroll.
 */
export const PEEK_EDGE_FRACTION = 0.1;
export const PEEK_MIN_PX = 60;

export function isPeekSwipe(dx: number, dy: number, startY: number, height: number): boolean {
  if (height <= 0) return false;
  if (startY < height * (1 - PEEK_EDGE_FRACTION)) return false;
  return -dy >= PEEK_MIN_PX && Math.abs(dy) > Math.abs(dx);
}

export interface ReadingInputOptions {
  dir(): ReadingDirection;
  onTurn(d: TurnDirection): void;
  onChrome(): void;
  /** Top-right corner tap: toggles the page's bookmark, chrome or not. */
  onCorner?(): void;
  /** Swipe up from the bottom edge: the Page Flip peek. */
  onPeek?(): void;
  /** False when the peek gesture does not apply (scroll mode scrolls instead). */
  peekEnabled?(): boolean;
  /** Gate for document-level keys (e.g. false while the reader is hidden). */
  keysEnabled?(): boolean;
}

/** Wire tap zones, swipe, and keys to a viewport. Returns a detach function. */
export function attachReadingInput(viewport: HTMLElement, opts: ReadingInputOptions): () => void {
  // A handled swipe also dispatches a click at the touch point; without this
  // flag one gesture would both swipe-turn and zone-turn.
  let suppressClick = false;
  let touchStart: { x: number; y: number } | null = null;
  // Every path reads the direction through this: the book's own progression
  // only reaches the input model once the renderer mirrors too.
  const dir = (): ReadingDirection => inputDirection(opts.dir());

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
    // The corner is carved out here, not inside zoneFor: the zone model stays
    // the pure three-way split, and the corner simply wins where they overlap.
    if (
      opts.onCorner &&
      isCornerTap(event.clientX - rect.left, event.clientY - rect.top, rect.width)
    ) {
      opts.onCorner();
      return;
    }
    const zone = zoneFor(event.clientX - rect.left, rect.width, dir());
    if (zone === 'chrome') opts.onChrome();
    else opts.onTurn(zone);
  };

  const onTouchStart = (event: TouchEvent): void => {
    // A new touch always starts unsuppressed. The flag is set by a handled
    // drag, and a drag long enough to be handled produces no compatibility
    // click to consume it — so clearing it only in onClick left it stuck, and
    // the tap AFTER a peek or a swipe-turn was silently eaten.
    suppressClick = false;
    const touch = event.touches[0];
    touchStart =
      touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onTouchEnd = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (!touchStart || !touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    const rect = viewport.getBoundingClientRect();
    const startY = touchStart.y - rect.top;
    touchStart = null;
    // The same guard onClick has: a drag that ends a selection belongs to the
    // annotation layer. Without it, a swipe up from the bottom band opened the
    // peek UNDERNEATH the live selection menu, and Escape then spent itself on
    // the peek rather than the menu the reader was looking at.
    if (hasSelection(event)) return;
    // The peek is checked first: it is the more specific gesture, and a
    // near-vertical swipe is never a page turn anyway.
    if (opts.onPeek && (opts.peekEnabled?.() ?? true) && isPeekSwipe(dx, dy, startY, rect.height)) {
      suppressClick = true;
      opts.onPeek();
      return;
    }
    const turn = swipeTurn(dx, dy, dir());
    if (!turn) return;
    suppressClick = true;
    opts.onTurn(turn);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (opts.keysEnabled && !opts.keysEnabled()) return;
    if (isEditable(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const turn = turnForKey(event.key, event.shiftKey, dir());
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

/** A tap or drag that ends a text selection must not also turn the page. */
function hasSelection(event: MouseEvent | TouchEvent): boolean {
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
