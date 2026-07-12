// Reader controller: chapter navigation, position capture, and restore.
// Owns no chrome; the app shell wires buttons and the TOC to these methods.

import type { Book } from '../epub/book.ts';
import type { PositionAnchor, ReadingPosition } from '../library/types.ts';
import { type RenderedChapter, renderChapter } from './render.ts';

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
}

const SAVE_DEBOUNCE_MS = 800;

export class ReaderController {
  private readonly book: Book;
  private readonly mount: HTMLElement;
  private readonly hooks: ControllerHooks;
  private readonly weights: number[];
  private readonly totalWeight: number;
  private readonly now: () => string;

  private chapterIndex = 0;
  private rendered: RenderedChapter | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    book: Book,
    mount: HTMLElement,
    hooks: ControllerHooks = {},
    now: () => string = () => new Date().toISOString(),
  ) {
    this.book = book;
    this.mount = mount;
    this.hooks = hooks;
    this.now = now;
    this.weights = book.chapterWeights();
    this.totalWeight = this.weights.reduce((a, b) => a + b, 0) || 1;
    this.mount.addEventListener('scroll', this.onScroll, { passive: true });
  }

  /** Render the book at a stored position, or at the beginning. */
  open(position: ReadingPosition | null): void {
    const index = clampIndex(position?.chapter ?? 0, this.book.chapters.length);
    this.renderChapterAt(index);
    if (position && this.rendered) {
      // Anchor first; raw scroll only as the fallback for anchor-less data.
      if (position.anchor) this.rendered.scrollToAnchor(position.anchor);
      else if (position.scroll !== undefined) this.rendered.setScroll(position.scroll);
    }
  }

  currentChapter(): number {
    return this.chapterIndex;
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
    this.rendered = renderChapter(this.book, chapter, this.mount);
    this.mount.scrollTop = 0;
    this.hooks.onChapter?.(index);
  }

  private readonly onScroll = (): void => {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.emitPosition(), SAVE_DEBOUNCE_MS);
  };

  private emitPosition(): void {
    if (!this.rendered) return;
    const anchor: PositionAnchor | null = this.rendered.getAnchor();
    const position: ReadingPosition = {
      chapter: this.chapterIndex,
      ...(anchor ? { anchor } : {}),
      scroll: this.rendered.getScroll(),
      updatedAt: this.now(),
    };
    this.hooks.onPosition?.({ position, progress: this.progress() });
  }

  /**
   * Length-weighted progress: chapters are weighted by their content size, so
   * a book with a huge final chapter doesn't claim 90% done at its halfway
   * point. The end of the last chapter reports exactly 1.
   */
  private progress(): number {
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
