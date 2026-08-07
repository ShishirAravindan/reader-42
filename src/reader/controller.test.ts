import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import { Book } from '../epub/book.ts';
import type { ReadingPosition } from '../library/types.ts';
import { type ControllerHooks, ReaderController, positionKey } from './controller.ts';
import type { DisplayMode } from './mode.ts';
import { DEFAULT_TYPOGRAPHY, type ReaderView } from './render.ts';

const view = (mode: DisplayMode): ReaderView => ({
  mode: () => mode,
  measureRem: () => 38,
  typography: () => DEFAULT_TYPOGRAPHY,
});

const at = (chapter: number, path: number[], ratio: number): ReadingPosition => ({
  chapter,
  anchor: { path, ratio },
  scroll: 0,
  updatedAt: '2026-07-14T00:00:00.000Z',
});

describe('positionKey', () => {
  test('ignores scroll pixels and the timestamp', () => {
    const a = { ...at(1, [39], 0.6), scroll: 100, updatedAt: 'a' };
    const b = { ...at(1, [39], 0.6), scroll: 999, updatedAt: 'b' };
    expect(positionKey(a)).toBe(positionKey(b));
  });

  test('distinguishes chapter, path, and ratio moves', () => {
    const base = positionKey(at(1, [39], 0.6));
    expect(positionKey(at(2, [39], 0.6))).not.toBe(base);
    expect(positionKey(at(1, [40], 0.6))).not.toBe(base);
    expect(positionKey(at(1, [39], 0.9))).not.toBe(base);
  });

  test('anchor-less positions collapse to a stable top key', () => {
    const top: ReadingPosition = { chapter: 0, scroll: 0, updatedAt: 'x' };
    expect(positionKey(top)).toBe(positionKey({ ...top, scroll: 50, updatedAt: 'y' }));
  });
});

// jsdom does no layout, so every chapter measures as a single page: an
// in-chapter turn immediately reports the chapter edge. That makes the
// chapter-crossing and book-boundary logic testable without geometry;
// in-chapter page math is covered by the demo scenes.
describe('turns across chapters and book boundaries', () => {
  async function make(mode: DisplayMode, hooks: ControllerHooks = {}) {
    const book = await Book.open(buildFixtureEpub());
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const controller = new ReaderController(book, mount, view(mode), hooks);
    controller.open(null);
    return { controller, mount };
  }

  test('forward at the chapter edge crosses to the next chapter', async () => {
    const chapters: number[] = [];
    const { controller } = await make('paged', { onChapter: (i) => chapters.push(i) });
    controller.turnForward();
    expect(controller.currentChapter()).toBe(1);
    expect(chapters).toEqual([0, 1]);
    controller.dispose();
  });

  test('back at the start of a chapter enters the previous chapter', async () => {
    const { controller } = await make('paged');
    controller.goToChapter(2);
    controller.turnBack();
    expect(controller.currentChapter()).toBe(1);
    controller.dispose();
  });

  test('book boundaries are gentle stops, no wrap', async () => {
    const edges: ('start' | 'end')[] = [];
    const { controller } = await make('paged', { onBoundary: (e) => edges.push(e) });
    controller.turnBack();
    expect(controller.currentChapter()).toBe(0);
    controller.goToChapter(2);
    controller.turnForward();
    expect(controller.currentChapter()).toBe(2);
    expect(edges).toEqual(['start', 'end']);
    controller.dispose();
  });

  test('custom weights drive length-honest progress (B4)', async () => {
    const book = await Book.open(buildFixtureEpub());
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const progresses: number[] = [];
    const controller = new ReaderController(
      book,
      mount,
      view('paged'),
      { onPosition: ({ progress }) => progresses.push(progress) },
      [300, 100, 0], // chapter 0 is three quarters of the book
    );
    controller.open(null);
    controller.goToChapter(1); // in jsdom fraction is 0: progress = chars before / total
    expect(progresses).toEqual([0.75]);
    expect(controller.progress()).toBe(0.75);
    expect(controller.currentFraction()).toBe(0);
    controller.dispose();
  });

  test('chapter crossings emit the new position immediately', async () => {
    const positions: number[] = [];
    const { controller } = await make('scroll', {
      onPosition: ({ position }) => positions.push(position.chapter),
    });
    controller.turnForward();
    controller.turnBack();
    expect(positions).toEqual([1, 0]);
    controller.dispose();
  });
});
