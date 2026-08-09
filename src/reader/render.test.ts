import { afterEach, describe, expect, test } from 'bun:test';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import { Book } from '../epub/book.ts';
import type { DisplayMode } from './mode.ts';
import {
  DEFAULT_TYPOGRAPHY,
  type ReaderView,
  type RenderedChapter,
  renderChapter,
  sanitizeContent,
  urlScheme,
} from './render.ts';

function body(html: string): Element {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body;
}

// jsdom has no FontFaceSet at all (document.fonts is undefined), so
// afterFaceLoads() returns instantly and the second pass never runs — the
// same reason the resize-observer wiring is guarded for jsdom. To exercise
// the second pass itself, these tests stand up a fake FontFaceSet whose
// `check` always reports "not resident", forcing the async branch every
// caller reaches for in a real browser on a face-arrival event, and hand
// back control of exactly when the face "arrives" via `release()`.
function fakeFontFaceSet(): { release: () => void } {
  let release = (): void => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      check: () => false,
      load: () => Promise.resolve([]),
      ready,
    },
  });
  return { release };
}

async function renderedFor(mode: DisplayMode): Promise<RenderedChapter> {
  const book = await Book.open(buildFixtureEpub());
  const chapter = book.chapters[1];
  if (!chapter) throw new Error('fixture epub has no second chapter');
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view: ReaderView = {
    mode: () => mode,
    measureChars: () => 66,
    typography: () => DEFAULT_TYPOGRAPHY,
  };
  return renderChapter(book, chapter, mount, view);
}

// Regression: the async face-arrival second pass (fonts.ts's afterFaceLoads,
// wired up in relayoutWhenFaceArrives) used to call `rendered.relayout()`
// with no argument at all once the face arrived. relayout()'s own contract
// is `remembered ?? anchorFor(...)` — a caller that reflows the layout
// itself must pass the place it already knows, or the fallback is a LIVE
// geometry read taken after the face swap has already changed the metrics,
// which is exactly the anchor-goes-stale bug the resize handler below it was
// written to avoid. This pins the same fix for the face-arrival path: it
// must thread `placed` through (paged) or explicit `null` (scroll), never
// an absent argument.
describe('relayoutWhenFaceArrives threading the remembered anchor', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'fonts');
  });

  test('paged mode passes the place it remembered, not an absent argument', async () => {
    const { release } = fakeFontFaceSet();
    const rendered = await renderedFor('paged');

    // A real, non-null anchor to remember — scrollToFraction always records
    // one, unlike a page turn, which jsdom's zero-geometry chapter can no-op
    // (every chapter measures as a single page: salvage's usual jsdom limit).
    rendered.scrollToFraction(0.5);
    const remembered = rendered.getAnchor();
    expect(remembered).not.toBeNull();

    const calls: unknown[][] = [];
    (rendered as unknown as { relayout: (...args: unknown[]) => void }).relayout = (
      ...args: unknown[]
    ) => calls.push(args);

    release(); // the face "arrives"
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    // The bug: zero arguments (remembered === undefined inside relayout(),
    // falling through to a live read). The fix: the anchor, explicitly.
    expect(calls[0]).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual(remembered);
  });

  test('scroll mode passes explicit null, matching the resize handler', async () => {
    const { release } = fakeFontFaceSet();
    const rendered = await renderedFor('scroll');

    const calls: unknown[][] = [];
    (rendered as unknown as { relayout: (...args: unknown[]) => void }).relayout = (
      ...args: unknown[]
    ) => calls.push(args);

    release();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(1);
    expect(calls[0]?.[0]).toBeNull();
  });
});

describe('sanitizeContent', () => {
  test('drops active-content elements', () => {
    const root = body('<p>ok</p><iframe src="evil"></iframe><object></object><embed>');
    sanitizeContent(root);
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('object')).toBeNull();
    expect(root.querySelector('embed')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('ok');
  });

  test('strips inline event handlers at every depth', () => {
    const root = body('<div onclick="x"><img src="a" onerror="y"><span onload="z">t</span></div>');
    sanitizeContent(root);
    expect(root.querySelector('div')?.hasAttribute('onclick')).toBe(false);
    expect(root.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(root.querySelector('span')?.hasAttribute('onload')).toBe(false);
  });
});

describe('urlScheme', () => {
  test('reads real schemes and ignores whitespace browsers strip', () => {
    expect(urlScheme('https://example.com')).toBe('https');
    expect(urlScheme('  javascript:alert(1)')).toBe('javascript');
    expect(urlScheme('java\tscript:alert(1)')).toBe('javascript');
    expect(urlScheme('MAILTO:a@b.com')).toBe('mailto');
  });

  test('relative and fragment links have no scheme', () => {
    expect(urlScheme('ch2.xhtml#p3')).toBeNull();
    expect(urlScheme('#p3')).toBeNull();
    expect(urlScheme('../images/fig.png')).toBeNull();
  });
});
