// Showcase recording: drives the real app through the reader's features and
// records a video of it. The acceptance scenes (run.ts) prove the behavior;
// this shows it to a human.
//
// Captions and tap markers are injected into the page, so the recording
// explains itself without editing. Nothing here asserts — a showcase that
// fails an assertion would just be a scene, and those live in scenes.ts.
//
// The server boot, the chromium launch, and the seeding transport come from
// harness.ts. They were copies here until one of them drifted: this script
// launched a hard-coded chromium path that exists on no machine, and nothing
// noticed, because nothing runs a recording in CI. Shared code cannot rot in
// only one of its copies.
//
//   bun scripts/demo/showcase.ts [--book path/to.epub] [--query word] [--headed]
//
// With no --book it uses the test fixture, so the script runs anywhere the
// repo does; the published recording uses a real public-domain book. --query
// is the word the search section looks for, and it has to be a word the book
// in hand actually contains: the default suits the fixture, and a real book
// wants its own.

import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import type { Page } from 'playwright';
import { readMetadata } from '../../src/epub/book.ts';
import { Library } from '../../src/library/store.ts';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import {
  FsTransport,
  launchChromium,
  makeLibraryDir,
  startDevServer,
  waitForServer,
} from './harness.ts';

// The EPUB parser needs a DOMParser; a plain `bun scripts/...` run has none
// (only `bun test` preloads one). Same reason as test/setup.ts.
(globalThis as { DOMParser?: unknown }).DOMParser ??= new JSDOM().window.DOMParser;

const OUT = path.join(import.meta.dir, 'out');
const VIDEO = { width: 1280, height: 800 };
const PORT = Number(process.env.PORT ?? 4301);
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const bookArg = args.includes('--book') ? args[args.indexOf('--book') + 1] : undefined;
/** A word the fixture is full of; override it whenever --book is given. */
const query = (args.includes('--query') ? args[args.indexOf('--query') + 1] : undefined) ?? 'quick';

// --- the overlay the recording talks through ---

const OVERLAY_CSS = `
  #showcase-caption {
    position: fixed;
    left: 50%;
    bottom: 3.2rem;
    transform: translateX(-50%) translateY(0.4rem);
    max-width: 46rem;
    z-index: 2147483647;
    pointer-events: none;
    background: rgba(18, 17, 15, 0.9);
    color: #f7f5ef;
    font: 500 1.05rem/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 0.7rem 1.1rem;
    border-radius: 10px;
    text-align: center;
    opacity: 0;
    transition: opacity 260ms ease, transform 260ms ease;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  }
  #showcase-caption.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  .showcase-tap {
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    border-radius: 50%;
    border: 2px solid rgba(51, 81, 138, 0.9);
    background: rgba(51, 81, 138, 0.22);
    animation: showcase-tap 620ms ease-out forwards;
  }
  @keyframes showcase-tap {
    0% { transform: scale(0.5); opacity: 0.95; }
    100% { transform: scale(1.5); opacity: 0; }
  }
`;

async function installOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    if (document.getElementById('showcase-caption')) return;
    const caption = document.createElement('div');
    caption.id = 'showcase-caption';
    document.body.appendChild(caption);
  });
}

async function say(page: Page, text: string, holdMs = 2600): Promise<void> {
  await page.evaluate((t: string) => {
    const el = document.getElementById('showcase-caption');
    if (!el) return;
    el.textContent = t;
    el.classList.add('on');
  }, text);
  await page.waitForTimeout(holdMs);
}

async function hush(page: Page, ms = 350): Promise<void> {
  await page.evaluate(() => document.getElementById('showcase-caption')?.classList.remove('on'));
  await page.waitForTimeout(ms);
}

/** Draw the tap marker, so the recording shows where a tap landed. */
async function mark(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]: number[]) => {
      const dot = document.createElement('div');
      dot.className = 'showcase-tap';
      dot.style.left = `${px}px`;
      dot.style.top = `${py}px`;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 700);
    },
    [x, y],
  );
  await page.waitForTimeout(180);
}

/** Click a raw point (the reading zones have no element of their own). */
async function tap(page: Page, x: number, y: number, settleMs = 700): Promise<void> {
  await mark(page, x, y);
  await page.mouse.click(x, y);
  await page.waitForTimeout(settleMs);
}

/**
 * Tap a control. Waits for it to be actually clickable first and clicks through
 * the locator (Playwright's own actionability checks), with the marker drawn at
 * its box — a raw coordinate click can land while chrome is still animating.
 */
async function tapSelector(page: Page, selector: string, settleMs = 700): Promise<void> {
  // .first(): a showcase taps "the next one of these", and several selectors
  // here (a search hit, a book on the shelf) legitimately match many.
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'visible', timeout: 8000 });
  const box = await target.boundingBox();
  if (box) await mark(page, box.x + box.width / 2, box.y + box.height / 2);
  await target.click();
  await page.waitForTimeout(settleMs);
}

/**
 * Open a chrome panel and wait for it. An overlay that is still up (a selection
 * menu, a dictionary card) swallows the next click by design, so clear anything
 * open first — Escape is exactly that — and retry the toggle once.
 */
async function openPanel(page: Page, toggle: string, panel: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await showChrome(page);
  await tapSelector(page, toggle, 300);
  try {
    await page.locator(panel).waitFor({ state: 'visible', timeout: 2500 });
  } catch {
    await tapSelector(page, toggle, 300);
    await page.locator(panel).waitFor({ state: 'visible', timeout: 5000 });
  }
  await page.waitForTimeout(400);
}

/** True when the reading chrome is currently out of the way. */
function chromeHidden(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.getElementById('reader')?.classList.contains('chrome-hidden') ?? false,
  );
}

/**
 * Reveal the chrome, deterministically. A centre tap toggles it, but a tap is a
 * pixel gamble — it can land on a link, or on a page that has not settled — and
 * a bar that is still `pointer-events: none` swallows the next click on it.
 * Escape only ever restores or closes, so it is the reliable way in.
 */
async function showChrome(page: Page): Promise<void> {
  if (!(await chromeHidden(page))) return;
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  if (await chromeHidden(page)) {
    // Something was open and Escape spent itself closing it; try again.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/** Put the chrome away only if it is up. */
async function hideChrome(page: Page): Promise<void> {
  if (!(await chromeHidden(page))) await tapZone(page, 0.5, 0.5, 400);
}

/** The reader's own zones, by fraction of the viewport. */
async function tapZone(page: Page, fx: number, fy = 0.5, settleMs = 700): Promise<void> {
  const box = await page.locator('#viewport').boundingBox();
  if (!box) throw new Error('no viewport');
  await tap(page, box.x + box.width * fx, box.y + box.height * fy, settleMs);
}

/**
 * Select the opening words of the first paragraph visible on this page, the way
 * a reader's drag would, and release. Chasing a literal string is fragile: the
 * page that happens to be on screen decides what there is to select.
 */
async function selectVisibleProse(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const viewport = document.getElementById('viewport');
    const shadow = viewport?.querySelector('.chapter-host')?.shadowRoot;
    if (!viewport || !shadow) return false;
    const vr = viewport.getBoundingClientRect();
    for (const p of Array.from(shadow.querySelectorAll('p'))) {
      const text = p.textContent ?? '';
      if (text.trim().length < 80) continue;
      const r = p.getBoundingClientRect();
      // Fully on the visible page, in both axes.
      if (r.left < vr.left || r.right > vr.right || r.top < vr.top) continue;
      const node = Array.from(p.childNodes).find(
        (n) => n.nodeType === 3 && (n as Text).data.trim().length > 60,
      ) as Text | undefined;
      if (!node) continue;
      const from = Math.max(node.data.search(/\S/), 0);
      // Stop on a word boundary; a highlight cut mid-word reads as a defect.
      let to = Math.min(from + 58, node.data.length);
      while (to < node.data.length && /\S/.test(node.data[to] as string)) to += 1;
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const box = range.getBoundingClientRect();
      viewport.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          composed: true,
          clientX: box.left + box.width / 2,
          clientY: box.bottom,
        }),
      );
      return true;
    }
    return false;
  });
}

/** A word on the visible page, for the dictionary. */
async function pointAtWord(page: Page, word: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((w: string) => {
    const viewport = document.getElementById('viewport');
    const shadow = viewport?.querySelector('.chapter-host')?.shadowRoot;
    if (!viewport || !shadow) return null;
    const vr = viewport.getBoundingClientRect();
    const walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(w);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + w.length);
      const r = range.getBoundingClientRect();
      // Only a word actually on the visible page is worth pointing at.
      if (r.width === 0 || r.left < vr.left || r.right > vr.right) continue;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, word);
}

async function scrub(page: Page, fraction: number): Promise<void> {
  await page.evaluate((f: number) => {
    const slider = document.getElementById('peek-slider') as HTMLInputElement | null;
    if (!slider) return;
    slider.value = String(Math.max(1, Math.round(Number(slider.max) * f)));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, fraction);
  await page.waitForTimeout(500);
}

// --- the walkthrough ---

mkdirSync(OUT, { recursive: true });
const libDir = makeLibraryDir('reader42-showcase-');
const bytes = bookArg ? new Uint8Array(readFileSync(bookArg)) : buildFixtureEpub();
const meta = await readMetadata(bytes).catch(() => ({
  title: 'The Fixture of Everything',
  author: 'A. Test Author',
  language: null,
  identifier: null,
}));
const seeded = await Library.open(new FsTransport(libDir));
await seeded.importBook(bytes, { title: meta.title, author: meta.author });
console.log(`showcase book: ${meta.title}${meta.author ? ` — ${meta.author}` : ''}`);

const server = startDevServer(PORT, libDir);

try {
  await waitForServer(`${BASE}/`);
  const browser = await launchChromium(!args.includes('--headed'));
  const context = await browser.newContext({
    viewport: VIDEO,
    recordVideo: { dir: OUT, size: VIDEO },
  });
  const page = await context.newPage();

  // 1. The library.
  await page.goto(`${BASE}/?lib=dev`);
  await page.locator('.book-title').first().waitFor();
  await installOverlay(page);
  await say(page, 'reader-42 — a local-first e-reader, built from scratch.', 3000);
  await say(page, 'The library is a folder of files. No server, no database.', 3000);
  await hush(page);

  // 2. Straight into the text.
  await tapSelector(page, '#book-list li', 1400);
  await installOverlay(page); // the reader section replaced the shelf
  await say(page, 'Opening a book lands straight in the text — no chrome, no decisions.', 3200);
  await hush(page);

  // Real books open on front matter; the rest of the walkthrough belongs on
  // prose, so jump into a chapter first via the book's own contents.
  await openPanel(page, '#toc-toggle', '#goto-panel');
  const named = page.locator('#toc a:has-text("In the Golden Age")');
  const chapterSelector =
    (await named.count()) > 0 ? '#toc a:has-text("In the Golden Age")' : '#toc a';
  await tapSelector(page, chapterSelector, 900);
  await page.waitForTimeout(900);
  await hideChrome(page);
  await hush(page);

  // 3. Turning pages.
  await say(page, 'Tap the right third to turn the page.', 2000);
  await tapZone(page, 0.85);
  await tapZone(page, 0.85);
  await hush(page, 200);
  await say(page, 'Space, arrows and swipes do the same. The left third goes back.', 2600);
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  await tapZone(page, 0.15);
  await hush(page);

  // 4. The status line.
  await say(page, 'The status line cycles: time left, location, print page, percent.', 2800);
  for (let i = 0; i < 3; i++) {
    await tapSelector(page, '#status-cycle', 1100);
  }
  await hush(page);

  // 5. Typography and themes.
  await showChrome(page);
  await say(page, 'Typography is real, and it is device-local taste.', 2400);
  await openPanel(page, '#aa-toggle', '#aa-panel');
  await say(page, 'Four faces, eight sizes, weight, spacing, margins, justification.', 2800);
  await tapSelector(page, '#aa-panel .aa-font-atkinson', 1000);
  await tapSelector(page, '#aa-panel #aa-size-up', 900);
  await tapSelector(page, '#aa-panel #aa-align-justify', 1100);
  await hush(page, 200);
  await say(page, 'Your place survives every change of type.', 2200);
  await tapSelector(page, '#aa-panel .aa-font-literata', 900);
  await tapSelector(page, '#aa-panel #aa-align-left', 900);
  await hush(page, 200);
  await say(page, 'Four page colors, from one set of tokens.', 2000);
  await tapSelector(page, '#aa-panel [data-theme="sepia"]', 1200);
  await tapSelector(page, '#aa-panel [data-theme="dark"]', 1600);
  await tapSelector(page, '#aa-panel [data-theme="paper"]', 1200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await hush(page);

  // 6. Highlights and notes.
  await say(page, 'Select any passage to highlight it.', 2200);
  if (!(await selectVisibleProse(page)))
    throw new Error('showcase: nothing to select on this page');
  await page.locator('#selection-menu').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(600);
  await hush(page, 150);
  await tapSelector(page, '#selection-menu .hl-dot-yellow', 1000);
  await say(page, 'Four colors, notes, and a copyable deep link per highlight.', 2600);
  await page.keyboard.press('Escape'); // put the menu away, as a reader would
  await page.waitForTimeout(300);
  await hush(page);

  // 7. The offline dictionary.
  const wordPoint =
    (await pointAtWord(page, 'time')) ??
    (await pointAtWord(page, 'the')) ??
    (await pointAtWord(page, 'and'));
  if (wordPoint) {
    await say(page, 'Double-tap a word for the offline dictionary.', 2200);
    await page.mouse.dblclick(wordPoint.x, wordPoint.y);
    await page.waitForTimeout(1600);
    await say(page, '102,000 entries, cached on the device. No network, ever.', 2800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await hush(page);

  // 8. Search.
  await openPanel(page, '#search-toggle', '#search-panel');
  await say(page, 'Search finds every occurrence — even across inline tags.', 2600);
  await page.locator('#search-input').fill(query);
  await page.locator('#search-input').press('Enter');
  await page.waitForTimeout(1400);
  await page
    .locator('#search-results .search-hit')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {
      throw new Error(
        `the search section found no hits for "${query}"; pass --query a word this book contains`,
      );
    });
  // The earliest hits for a word that names a chapter are in the contents;
  // a later one is in the story, which is what the jump should show.
  const hits = page.locator('#search-results .search-hit');
  const pick = Math.min(4, (await hits.count()) - 1);
  const chosen = hits.nth(Math.max(pick, 0));
  const chosenBox = await chosen.boundingBox();
  if (chosenBox)
    await mark(page, chosenBox.x + chosenBox.width / 2, chosenBox.y + chosenBox.height / 2);
  await chosen.click();
  await page.waitForTimeout(1600);
  await say(page, 'Every hit on the page is lit; the one you chose pulses.', 2600);
  await hush(page);

  // 9. The notebook.
  await openPanel(page, '#notebook-toggle', '#notebook');
  await say(page, 'The notebook collects your highlights, by chapter.', 2600);
  await say(page, 'Export is a Logseq outline: text, chapter, deep link, note.', 2800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await hush(page);

  // 10. Bookmarks.
  await say(page, 'Tap the top-right corner to bookmark a page.', 2400);
  const vb = await page.locator('#viewport').boundingBox();
  if (vb) await tap(page, vb.x + vb.width - 24, vb.y + 24, 1200);
  await say(page, 'The dog-ear lives in the synced sidecar, so it follows you.', 2600);
  await hush(page);

  // 11. Go To.
  await openPanel(page, '#toc-toggle', '#goto-panel');
  await say(page, 'Go To: contents, your bookmarks, and a location or print page.', 3000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await hush(page);

  // 12. Page Flip, opened from the hairline's progress rule.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await tapSelector(page, '#status-track', 400);
  await page.locator('#peek-sheet').waitFor({ state: 'visible', timeout: 5000 });
  await say(page, 'Tap the progress rule to look anywhere in the book…', 2200);
  await scrub(page, 0.45);
  await scrub(page, 0.7);
  await say(page, '…while the page you are on never moves.', 2600);
  await tapSelector(page, '#peek-go', 1400);
  await say(page, 'And every jump leaves a way back.', 2400);
  await tapSelector(page, '#jump-back', 1400);
  await hush(page);

  // 13. Scroll mode, which lives in the type panel with the rest of taste.
  await openPanel(page, '#aa-toggle', '#aa-panel');
  await tapSelector(page, '#aa-layout-scroll', 1200);
  await say(page, 'Or read as one continuous scroll.', 2200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(1000);
  await say(page, 'Positions are structural, so your place survives the switch.', 2800);
  await openPanel(page, '#aa-toggle', '#aa-panel');
  await tapSelector(page, '#aa-layout-paged', 1400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await hush(page);

  await hideChrome(page);
  await say(page, 'Offline, files-first, and yours. reader-42.', 3200);
  await hush(page, 600);

  await context.close(); // flushes the video
  await browser.close();

  // Playwright names videos by a random id; give it a stable name.
  const { readdirSync } = await import('node:fs');
  const videos = readdirSync(OUT)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: Bun.file(path.join(OUT, f)).lastModified }))
    .sort((a, b) => b.t - a.t);
  const newest = videos[0];
  if (newest) {
    const target = path.join(OUT, 'reader-42-showcase.webm');
    if (path.join(OUT, newest.f) !== target) renameSync(path.join(OUT, newest.f), target);
    console.log(`\nvideo: ${target}`);
  }
} finally {
  server.kill();
  rmSync(libDir, { recursive: true, force: true });
}
