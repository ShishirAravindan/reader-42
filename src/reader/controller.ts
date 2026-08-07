// Reader controller: chapter navigation, position capture, and restore.
// Owns no chrome; the app shell wires buttons and the TOC to these methods.

import type { Book } from '../epub/book.ts';
import type { PositionAnchor, ReadingPosition } from '../library/types.ts';
import { LOCATION_SPAN, anchorAtChars, charsBeforeAnchor } from './metrics.ts';
import { type ReaderView, type RenderedChapter, renderChapter } from './render.ts';

export interface PositionUpdate {
  position: ReadingPosition;
  /** Length-weighted overall progress, 0..1. */
  progress: number;
}

export interface ControllerHooks {
  /** Called (debounced) whenever the reading position changes. */
  onPosition?(update: PositionUpdate): void;
  /** Called when the visible chapter changes (render, prev/next, TOC jump). */
  onChapter?(index: number): void;
  /** A turn hit the book edge: gentle stop, no wrap; the caller may hint. */
  onBoundary?(edge: 'start' | 'end'): void;
}

const SAVE_DEBOUNCE_MS = 800;

/**
 * The share of the book a chapter with no countable text still occupies. A
 * plate, a full-page map, a colophon that is one image: they flatten to zero
 * characters, and a chapter worth zero is a chapter the reader passes through
 * without the percentage moving — worse, a book whose trailing chapters are
 * all images reports 100% while a page of it is still unread. One location's
 * worth is the smallest honest floor: enough to be somewhere, too little to
 * distort a book made of text.
 */
const MIN_CHAPTER_WEIGHT = LOCATION_SPAN;

export class ReaderController {
  private readonly book: Book;
  private readonly mount: HTMLElement;
  private readonly view: ReaderView;
  private readonly hooks: ControllerHooks;
  /** Flattened character count per spine chapter; the progress substrate. */
  private readonly chapterChars: number[];
  /** Sum of the floored per-chapter weights (see MIN_CHAPTER_WEIGHT). */
  private readonly totalWeight: number;
  private readonly now: () => string;

  private chapterIndex = 0;
  private rendered: RenderedChapter | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Structural signature of the last position we saved or restored. */
  private lastPositionKey: string | null = null;
  /** Memoized character offset of the current anchor (see charsIntoChapter). */
  private charCache: { key: string; chars: number } | null = null;
  /** Set while a visit() runs: navigation that is not the reader's place. */
  private visiting = false;

  constructor(
    book: Book,
    mount: HTMLElement,
    view: ReaderView,
    // Required, and character counts specifically (parity B4): progress and
    // every reported location are counted in characters of flattened chapter
    // text. There is no byte-approximation fallback — a second progress model
    // would disagree with the location index silently.
    chapterChars: number[],
    hooks: ControllerHooks = {},
    now: () => string = () => new Date().toISOString(),
  ) {
    this.book = book;
    this.mount = mount;
    this.view = view;
    this.hooks = hooks;
    this.now = now;
    this.chapterChars = chapterChars;
    this.totalWeight =
      this.book.chapters.reduce((sum, _chapter, i) => sum + this.weightOf(i), 0) || 1;
    this.mount.addEventListener('scroll', this.onScroll, { passive: true });
  }

  /** Render the book at a stored position, or at the beginning. */
  open(position: ReadingPosition | null): void {
    const index = clampIndex(position?.chapter ?? 0, this.book.chapters.length);
    this.renderChapterAt(index);
    // The anchor is the whole restore: an anchor-less position is "the top of
    // this chapter", which renderChapterAt has already done. There is no pixel
    // fallback — a saved pixel offset means a different place in the other
    // display mode and at every other type size.
    if (position?.anchor && this.rendered) this.rendered.scrollToAnchor(position.anchor);
    // Baseline the restored place so the scroll event the restore just fired
    // doesn't re-save it. Re-saving would bump `updatedAt` on a position the
    // reader never actually moved, and under latest-wins sync that stale-but-
    // fresh timestamp could clobber a newer position from another device.
    const restored = this.capturePosition();
    this.lastPositionKey = restored ? positionKey(restored) : null;
  }

  currentChapter(): number {
    return this.chapterIndex;
  }

  /** The live rendered chapter, for layers that mark or measure its DOM. */
  chapterView(): RenderedChapter | null {
    return this.rendered;
  }

  /**
   * How far through the current chapter the viewport start sits, 0..1, counted
   * in CHARACTERS of the chapter's text (parity B1/B4). Everything the reader
   * is told derives from this — location, print page, percent, time left — so
   * it must not move when the layout does. A scroll-extent fraction would:
   * raise the type size and a chapter opening with a fixed-height image gets
   * taller in text but not in image, and the same paragraph reports a smaller
   * fraction. Page turning and `atEnd` stay geometric, where geometry is the
   * truth.
   */
  currentFraction(): number {
    const rendered = this.rendered;
    if (!rendered) return 0;
    const chars = this.chapterChars[this.chapterIndex] ?? 0;
    // A chapter with no text at all (an image plate) has no character
    // coordinates to report; geometry is the only signal left.
    if (chars <= 0) return rendered.chapterFraction();
    return Math.min(Math.max(this.charsIntoChapter() / chars, 0), 1);
  }

  /** Structural locator for the current page start; what a bookmark records. */
  currentAnchor(): PositionAnchor | null {
    return this.rendered?.getAnchor() ?? null;
  }

  /** True when an anchor in the CURRENT chapter is on the visible page. */
  anchorInView(chapter: number, anchor: PositionAnchor): boolean {
    if (chapter !== this.chapterIndex || !this.rendered) return false;
    return this.rendered.anchorInView(anchor);
  }

  /** The place the reader is at right now, for stacks that want to return to it. */
  currentPosition(): ReadingPosition | null {
    return this.capturePosition();
  }

  /** Restore a captured place (jump-back, peek return): chapter, then anchor. */
  goToPosition(position: ReadingPosition): boolean {
    if (!this.goToChapter(position.chapter)) return false;
    if (position.anchor) this.rendered?.scrollToAnchor(position.anchor);
    this.emitPosition();
    return true;
  }

  /**
   * Jump to a fraction of a chapter's TEXT (location entry, print pages, the
   * peek slider). The fraction is counted in characters, like everything the
   * reader is shown, so it is resolved to the element holding those characters
   * and restored as an anchor: the reader lands on the page that actually
   * holds the location they asked for, through the same page-snap an anchor
   * restore uses. A share of the scroll extent would land short — the paged
   * extent ends at the last page's START, so its fraction 1 is a page early.
   */
  goToFraction(chapter: number, fraction: number): boolean {
    if (chapter < 0 || chapter >= this.book.chapters.length) return false;
    if (chapter !== this.chapterIndex) this.renderChapterAt(chapter);
    const rendered = this.rendered;
    if (rendered) {
      const chars = this.chapterChars[chapter] ?? 0;
      // A chapter with no text has no character coordinates; geometry is all
      // there is to aim at.
      if (chars > 0) rendered.scrollToAnchor(anchorAtChars(rendered.wrapper, fraction * chars));
      else rendered.scrollToFraction(fraction);
    }
    this.emitPosition();
    return true;
  }

  /**
   * One page (or most of a screen, in scroll mode) forward; crosses into the
   * next chapter at the chapter edge. At the end of the book: a gentle stop.
   * Same-chapter turns save through the debounced scroll path (programmatic
   * scrolls fire scroll events); chapter crossings save immediately.
   */
  turnForward(): void {
    if (!this.rendered) return;
    if (this.rendered.turnForward()) return;
    if (this.chapterIndex + 1 >= this.book.chapters.length) {
      this.hooks.onBoundary?.('end');
      return;
    }
    this.goToChapter(this.chapterIndex + 1);
  }

  /** Backward counterpart; entering the previous chapter lands on its end. */
  turnBack(): void {
    if (!this.rendered) return;
    if (this.rendered.turnBack()) return;
    if (this.chapterIndex === 0) {
      this.hooks.onBoundary?.('start');
      return;
    }
    this.renderChapterAt(this.chapterIndex - 1);
    this.rendered?.toEnd();
    this.emitPosition();
  }

  /**
   * Re-derive layout and re-emit the position after anything the ReaderView
   * feeds the renderer changed: display mode, typography, measure. The
   * renderer captures the anchor against the old layout, applies the new
   * CSS, and restores — the reading position survives every change.
   */
  relayout(): void {
    this.rendered?.relayout();
    this.emitPosition();
  }

  /**
   * Navigate somewhere WITHOUT claiming it as the reader's place. Following a
   * year-old highlight deep link at 80% of a book must not overwrite the
   * synced position with chapter 2: there is no undo for that, and the link
   * was a look, not a move. So the jump renders and scrolls, nothing is
   * written, and the position clock is re-baselined at where it landed — the
   * next real move from there (a turn, a scroll, a jump) saves normally. A
   * visit the reader abandons leaves their place exactly as they left it.
   */
  visit(run: () => void): void {
    this.visiting = true;
    try {
      run();
    } finally {
      this.visiting = false;
      const landed = this.capturePosition();
      this.lastPositionKey = landed ? positionKey(landed) : null;
    }
  }

  goToChapter(index: number, fragment?: string): boolean {
    if (index < 0 || index >= this.book.chapters.length) return false;
    this.renderChapterAt(index);
    if (fragment) this.rendered?.scrollToFragment(fragment);
    this.emitPosition(); // chapter changes save immediately, not debounced
    return true;
  }

  /** Jump to a TOC target by archive path (and optional fragment). */
  goToPath(path: string, fragment: string | null): boolean {
    const index = this.book.chapterIndexByPath(path);
    if (index < 0) return false;
    return this.goToChapter(index, fragment ?? undefined);
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.mount.removeEventListener('scroll', this.onScroll);
    this.rendered?.dispose();
    this.rendered = null;
  }

  /**
   * The reading place as a character offset into the current chapter. Walking
   * the chapter text is cheap but not free, and the status line asks several
   * times per refresh, so the answer is remembered until the anchor moves.
   */
  private charsIntoChapter(): number {
    const rendered = this.rendered;
    if (!rendered) return 0;
    const anchor = rendered.getAnchor();
    if (anchor) {
      const key = `${this.chapterIndex}|${anchor.path.join(',')}@${anchor.ratio}`;
      if (this.charCache?.key === key) return this.charCache.chars;
      const chars = charsBeforeAnchor(rendered.wrapper, anchor);
      if (chars !== null) {
        this.charCache = { key, chars };
        return chars;
      }
    }
    // No anchor resolved (a position from a chapter whose structure changed).
    // Geometry is worse but it is what is left; never cached, since it moves
    // with the scroll while the anchor key would not.
    return (this.chapterChars[this.chapterIndex] ?? 0) * rendered.chapterFraction();
  }

  private renderChapterAt(index: number): void {
    const chapter = this.book.chapters[index];
    if (!chapter) return;
    this.rendered?.dispose();
    this.chapterIndex = index;
    this.rendered = renderChapter(this.book, chapter, this.mount, this.view);
    this.mount.scrollTop = 0;
    this.mount.scrollLeft = 0;
    this.hooks.onChapter?.(index);
  }

  private readonly onScroll = (): void => {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.emitPosition(), SAVE_DEBOUNCE_MS);
  };

  private capturePosition(): ReadingPosition | null {
    if (!this.rendered) return null;
    const anchor: PositionAnchor | null = this.rendered.getAnchor();
    return {
      chapter: this.chapterIndex,
      ...(anchor ? { anchor } : {}),
      updatedAt: this.now(),
    };
  }

  private emitPosition(): void {
    if (this.visiting) return; // a visit() is not the reader's place
    const position = this.capturePosition();
    if (!position) return;
    // Skip saves that don't move the structural position; only the reader
    // actually reading should refresh the position clock.
    const key = positionKey(position);
    if (key === this.lastPositionKey) return;
    this.lastPositionKey = key;
    this.hooks.onPosition?.({ position, progress: this.progress() });
  }

  /**
   * The reader is on the last page of the last chapter (parity B6). A PLACE,
   * deliberately not "progress() >= 1": progress is a ratio of weights and can
   * round or saturate at the end of any late chapter, and the shell uses this
   * to pin "Loc Y of Y" and to nudge the finished state. Those must mean the
   * reader reached the end, never that the arithmetic ran out of room.
   */
  atBookEnd(): boolean {
    if (!this.rendered) return false;
    return this.chapterIndex === this.book.chapters.length - 1 && this.rendered.atEnd();
  }

  /**
   * Character-weighted progress (parity B4): chapters are weighted by how much
   * text they hold, so a book with a huge final chapter doesn't claim 90% done
   * at its halfway point. Only the end of the book reports exactly 1. Public so
   * the status line can render immediately, without waiting for a debounced
   * save.
   */
  progress(): number {
    if (!this.rendered) return 0;
    if (this.atBookEnd()) return 1;
    let before = 0;
    for (let i = 0; i < this.chapterIndex; i++) before += this.weightOf(i);
    const current = this.weightOf(this.chapterIndex) * this.currentFraction();
    return Math.min((before + current) / this.totalWeight, 1);
  }

  /** A chapter's share of the book, floored so no chapter is worth nothing. */
  private weightOf(chapter: number): number {
    return Math.max(this.chapterChars[chapter] ?? 0, MIN_CHAPTER_WEIGHT);
  }
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}

/**
 * Structural identity of a position: chapter plus anchor, ignoring the
 * timestamp. Two positions with the same key describe the same place, so only
 * a real move is worth saving.
 */
export function positionKey(position: ReadingPosition): string {
  const anchor = position.anchor
    ? `${position.anchor.path.join(',')}@${position.anchor.ratio.toFixed(3)}`
    : 'top';
  return `${position.chapter}|${anchor}`;
}
