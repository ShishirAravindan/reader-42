import { describe, expect, test } from 'bun:test';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import { Book } from '../epub/book.ts';
import type { ReadingPosition } from '../library/types.ts';
import { type ControllerHooks, ReaderController, positionKey } from './controller.ts';
import { bookMetrics, charsBeforeAnchor } from './metrics.ts';
import type { DisplayMode } from './mode.ts';
import { DEFAULT_TYPOGRAPHY, type ReaderView, type RenderedChapter } from './render.ts';

const view = (mode: DisplayMode): ReaderView => ({
  mode: () => mode,
  measureChars: () => 66,
  typography: () => DEFAULT_TYPOGRAPHY,
});

const at = (chapter: number, path: number[], ratio: number): ReadingPosition => ({
  chapter,
  anchor: { path, ratio },
  updatedAt: '2026-07-14T00:00:00.000Z',
});

describe('positionKey', () => {
  test('ignores the timestamp', () => {
    expect(positionKey({ ...at(1, [39], 0.6), updatedAt: 'a' })).toBe(
      positionKey({ ...at(1, [39], 0.6), updatedAt: 'b' }),
    );
  });

  test('distinguishes chapter, path, and ratio moves', () => {
    const base = positionKey(at(1, [39], 0.6));
    expect(positionKey(at(2, [39], 0.6))).not.toBe(base);
    expect(positionKey(at(1, [40], 0.6))).not.toBe(base);
    expect(positionKey(at(1, [39], 0.9))).not.toBe(base);
  });

  test('anchor-less positions collapse to a stable top key', () => {
    const top: ReadingPosition = { chapter: 0, updatedAt: 'x' };
    expect(positionKey(top)).toBe(positionKey({ ...top, updatedAt: 'y' }));
  });
});

// jsdom does no layout, so every chapter measures as a single page: an
// in-chapter turn immediately reports the chapter edge. That makes the
// chapter-crossing and book-boundary logic testable without geometry;
// in-chapter page math is covered by the demo scenes.
describe('turns across chapters and book boundaries', () => {
  async function make(mode: DisplayMode, hooks: ControllerHooks = {}, chars?: number[]) {
    const book = await Book.open(buildFixtureEpub());
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const metrics = bookMetrics(book);
    const controller = new ReaderController(
      book,
      mount,
      view(mode),
      chars ?? metrics.chapterChars,
      hooks,
    );
    controller.open(null);
    return { controller, mount, metrics };
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

  test('character counts drive length-honest progress (B4)', async () => {
    const progresses: number[] = [];
    // Chapter 0 holds three quarters of the book's text.
    const { controller } = await make(
      'paged',
      { onPosition: ({ progress }) => progresses.push(progress) },
      [3000, 1000, 1000],
    );
    controller.goToChapter(1); // in jsdom fraction is 0: progress = chars before / total
    expect(progresses).toEqual([0.6]);
    expect(controller.progress()).toBe(0.6);
    expect(controller.currentFraction()).toBe(0);
    controller.dispose();
  });

  // The most load-bearing constraint in the project: positions are structural
  // and mode-independent. A pixel offset captured in paged mode is a column
  // offset; restoring it in scroll mode lands that many pixels DOWN an
  // unrelated part of the chapter, and a type-size change moves it too.
  test('a captured position carries no pixel offset at all', async () => {
    const { controller } = await make('paged');
    const position = controller.currentPosition();
    expect(position).not.toBeNull();
    expect(Object.keys(position as object).sort()).toEqual(['anchor', 'chapter', 'updatedAt']);
    controller.dispose();
  });

  test('a saved position emitted to the sidecar is structural only', async () => {
    const saved: ReadingPosition[] = [];
    const { controller } = await make('scroll', {
      onPosition: ({ position }) => saved.push(position),
    });
    controller.goToChapter(1);
    expect(saved).toHaveLength(1);
    for (const position of saved) {
      expect(position).not.toHaveProperty('scroll');
    }
    controller.dispose();
  });

  // Old sidecars may still carry `scroll`; opening one must ignore it rather
  // than restore a pixel offset (or crash on the unknown field).
  test('a legacy position with a scroll field opens without using it', async () => {
    const { controller } = await make('scroll');
    const legacy = { chapter: 1, scroll: 2400, updatedAt: 'x' } as ReadingPosition;
    controller.open(legacy);
    expect(controller.currentChapter()).toBe(1);
    expect(controller.currentPosition()).not.toHaveProperty('scroll');
    controller.dispose();
  });

  // Parity B1: a location is a device-independent address, stable across
  // font, size, and margin changes. jsdom does no layout, so the two sides
  // are simulated: the anchor is what a real browser captures at the viewport
  // start (the same paragraph before and after the type-size change), and
  // chapterFraction() is what that place measures as in scroll extent — which
  // really does move, e.g. when a chapter opens on a fixed-height image and
  // the text around it doubles in height.
  test('a font-size change moves the layout, not the reported location (B1)', async () => {
    const { controller, metrics } = await make('scroll');
    controller.goToChapter(1);
    const view = controller.chapterView() as RenderedChapter;
    view.getAnchor = () => ({ path: [30], ratio: 0 });

    view.chapterFraction = () => 0.2;
    const fraction = controller.currentFraction();
    const location = metrics.locationOf(1, fraction);
    const progress = controller.progress();

    view.chapterFraction = () => 0.1; // two size steps up: the layout moved
    expect(controller.currentFraction()).toBe(fraction);
    expect(metrics.locationOf(1, controller.currentFraction())).toBe(location);
    expect(controller.progress()).toBe(progress);

    // ...and it is genuinely counted, not the geometry passed through.
    expect(fraction).not.toBe(0.2);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
    controller.dispose();
  });

  test('the reported fraction is the anchor as a share of the chapter text', async () => {
    const { controller, metrics } = await make('scroll');
    controller.goToChapter(1);
    const view = controller.chapterView() as RenderedChapter;
    const wrapper = view.wrapper;
    view.getAnchor = () => ({ path: [30], ratio: 0 });
    const expected =
      (charsBeforeAnchor(wrapper, { path: [30], ratio: 0 }) ?? 0) /
      (metrics.chapterChars[1] as number);
    expect(controller.currentFraction()).toBeCloseTo(expected, 10);
    controller.dispose();
  });

  // An image-only spine item (a plate, a full-page map, a one-image colophon)
  // flattens to zero characters. Weighted at zero it is worth nothing, so the
  // book claims to be finished while a page of it is still unread.
  describe('chapters with no countable text (B4/B6)', () => {
    const atEndOfChapter = (controller: ReaderController): void => {
      const view = controller.chapterView() as RenderedChapter;
      view.getAnchor = () => null; // no structure to anchor to
      view.chapterFraction = () => 1;
      view.atEnd = () => true;
    };

    test('a zero-character chapter still occupies part of the book', async () => {
      const { controller } = await make('paged', {}, [300, 100, 0]);
      controller.goToChapter(1);
      // 300 of (300 + 100 + a floor), not 300 of 400.
      expect(controller.progress()).toBeLessThan(0.75);
      expect(controller.progress()).toBeGreaterThan(0.5);
      controller.dispose();
    });

    test('progress does not reach 1 at the end of the second-to-last chapter', async () => {
      const { controller } = await make('paged', {}, [300, 100, 0]);
      controller.goToChapter(1);
      atEndOfChapter(controller);
      expect(controller.currentFraction()).toBe(1);
      expect(controller.progress()).toBeLessThan(1);
      expect(controller.atBookEnd()).toBe(false);
      controller.dispose();
    });

    test('the book ends at the last page, not when the arithmetic runs out', async () => {
      const { controller } = await make('paged', {}, [300, 100, 0]);
      controller.goToChapter(2);
      const view = controller.chapterView() as RenderedChapter;
      view.chapterFraction = () => 0;
      view.atEnd = () => false; // a page of the image plate still to come
      expect(controller.atBookEnd()).toBe(false);
      expect(controller.progress()).toBeLessThan(1);
      view.atEnd = () => true;
      expect(controller.atBookEnd()).toBe(true);
      expect(controller.progress()).toBe(1);
      controller.dispose();
    });
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
