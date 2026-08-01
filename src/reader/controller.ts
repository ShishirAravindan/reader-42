// Reader controller: chapter navigation, position capture, and restore.
// Owns no chrome; the app shell wires buttons and the TOC to these methods.

import type { Book } from '../epub/book.ts';
import type { PositionAnchor, ReadingPosition } from '../library/types.ts';
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

export class ReaderController {
  private readonly book: Book;
  private readonly mount: HTMLElement;
  private readonly view: ReaderView;
  private readonly hooks: ControllerHooks;
  private readonly weights: number[];
  private readonly totalWeight: number;
  private readonly now: () => string;

  private chapterIndex = 0;
  private rendered: RenderedChapter | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Structural signature of the last position we saved or restored. */
  private lastPositionKey: string | null = null;

  constructor(
    book: Book,
    mount: HTMLElement,
    view: ReaderView,
    hooks: ControllerHooks = {},
    // Character counts when the caller has them (honest progress, parity B4);
    // decompressed-byte approximation otherwise.
    weights?: number[],
    now: () => string = () => new Date().toISOString(),
  ) {
    this.book = book;
    this.mount = mount;
    this.view = view;
    this.hooks = hooks;
    this.now = now;
    this.weights = weights ?? book.chapterWeights();
    this.totalWeight = this.weights.reduce((a, b) => a + b, 0) || 1;
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

  /** How far through the current chapter the viewport start sits, 0..1. */
  currentFraction(): number {
    return this.rendered?.chapterFraction() ?? 0;
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
   * Jump to a fraction of a chapter (location entry, the peek slider). The
   * offset lands through the same clamped page-snap an anchor restore uses,
   * so the reader never stops between pages.
   */
  goToFraction(chapter: number, fraction: number): boolean {
    if (chapter < 0 || chapter >= this.book.chapters.length) return false;
    if (chapter !== this.chapterIndex) this.renderChapterAt(chapter);
    this.rendered?.scrollToFraction(fraction);
    this.emitPosition();
    return true;
  }

  chapterCount(): number {
    return this.book.chapters.length;
  }

  nextChapter(): boolean {
    return this.goToChapter(this.chapterIndex + 1);
  }

  prevChapter(): boolean {
    return this.goToChapter(this.chapterIndex - 1);
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
   * Length-weighted progress: chapters are weighted by their content size, so
   * a book with a huge final chapter doesn't claim 90% done at its halfway
   * point. The end of the last chapter reports exactly 1. Public so the
   * status line can render immediately, without waiting for a debounced save.
   */
  progress(): number {
    if (!this.rendered) return 0;
    if (this.chapterIndex === this.book.chapters.length - 1 && this.rendered.atEnd()) return 1;
    let before = 0;
    for (let i = 0; i < this.chapterIndex; i++) before += this.weights[i] ?? 0;
    const current = (this.weights[this.chapterIndex] ?? 0) * this.rendered.chapterFraction();
    return Math.min((before + current) / this.totalWeight, 1);
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
