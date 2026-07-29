// The page-model acceptance scenes (Epic 1). Each scene asserts load-bearing
// behavior before capturing evidence; the worst rendering bugs (zero-width
// pagination, mode-switch position loss) are only catchable this way.

import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import { expect, expectEq, scene } from './harness.ts';

const TITLE = 'The Fixture of Everything';

interface ViewportMetrics {
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  overflowY: string;
}

function metrics(page: Page): Promise<ViewportMetrics> {
  return page.evaluate(() => {
    const v = document.getElementById('viewport') as HTMLElement;
    return {
      scrollLeft: v.scrollLeft,
      scrollTop: v.scrollTop,
      scrollWidth: v.scrollWidth,
      scrollHeight: v.scrollHeight,
      clientWidth: v.clientWidth,
      clientHeight: v.clientHeight,
      overflowY: getComputedStyle(v).overflowY,
    };
  });
}

/**
 * Id of the paragraph at the viewport start, walking the shadow root. In
 * paged mode that is the first paragraph whose box reaches past the page's
 * left edge; in scroll mode, past the top edge. Matches the anchor semantics
 * (the element spanning the viewport start).
 */
function firstVisibleParagraph(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const v = document.getElementById('viewport') as HTMLElement;
    const wrapper = v.querySelector('.chapter-host')?.shadowRoot?.querySelector('.chapter');
    if (!wrapper) return null;
    const paged = getComputedStyle(v).overflowY === 'hidden';
    const vr = v.getBoundingClientRect();
    for (const p of Array.from(wrapper.querySelectorAll('p[id]'))) {
      const r = p.getBoundingClientRect();
      if (paged ? r.right > vr.left + 1 : r.bottom > vr.top + 1) return p.id;
    }
    return null;
  });
}

function chromeHidden(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.getElementById('reader')?.classList.contains('chrome-hidden') ?? false,
  );
}

async function centerTap(page: Page): Promise<void> {
  await page.mouse.click(640, 400);
  await page.waitForTimeout(80);
}

async function zoneClick(page: Page, zone: 'back' | 'forward'): Promise<void> {
  await page.mouse.click(zone === 'forward' ? 1100 : 180, 400);
  await page.waitForTimeout(80);
}

async function tocNav(page: Page, label: string): Promise<void> {
  if (await chromeHidden(page)) await centerTap(page);
  await page.locator('#toc-toggle').click();
  await page.locator('#toc a', { hasText: label }).click();
  await page.waitForTimeout(80);
}

async function chapterLabel(page: Page): Promise<string> {
  return (await page.locator('#reader-chapter-label').textContent()) ?? '';
}

scene('import-and-open', async ({ page, base, capture }) => {
  await page.goto(`${base}/?lib=dev`);
  await page.locator('#shelf').waitFor({ state: 'visible' });
  await page.setInputFiles('#import-input', {
    name: 'fixture.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(buildFixtureEpub()),
  });
  await page.getByText(TITLE).click();
  await page.getByRole('heading', { name: 'One: A Beginning' }).waitFor();

  expect(await chromeHidden(page), 'book opens straight into text: chrome hidden');
  let m = await metrics(page);
  expectEq(m.overflowY, 'hidden', 'paged is the default: the mount cannot scroll vertically');

  // Chapter 2 is long by construction: pagination must produce real pages.
  // Salvage §2: if the columns fail to overflow the host, scrollWidth stays
  // at one page and this assertion is the only thing that notices.
  await tocNav(page, 'Two: The Long Middle');
  m = await metrics(page);
  expectEq(await chapterLabel(page), '2 of 3', 'toc jump landed in chapter 2');
  expect(
    m.scrollWidth >= 2 * m.clientWidth,
    `chapter 2 paginates to multiple pages (scrollWidth ${m.scrollWidth} vs page ${m.clientWidth})`,
  );
  expectEq(m.scrollWidth % m.clientWidth, 0, 'scroll extent is a whole number of pages');
  await capture('open-paged');
});

scene('page-turns', async ({ page, capture }) => {
  // Book start: turning back on page 0 of chapter 1 is a gentle stop.
  await tocNav(page, 'One: A Beginning');
  expectEq(await chapterLabel(page), '1 of 3', 'back at chapter 1');
  await zoneClick(page, 'back');
  let m = await metrics(page);
  expectEq(m.scrollLeft, 0, 'gentle stop at the book start: no move');
  expectEq(await chapterLabel(page), '1 of 3', 'gentle stop at the book start: no wrap');

  // Forward past the last page of a chapter crosses into the next chapter.
  await zoneClick(page, 'forward');
  expectEq(await chapterLabel(page), '2 of 3', 'forward past the chapter end enters chapter 2');
  m = await metrics(page);
  expectEq(m.scrollLeft, 0, 'entering forward lands on the first page');

  // In-chapter turns move exactly one page: scrollLeft is a stride multiple.
  await zoneClick(page, 'forward');
  m = await metrics(page);
  expectEq(m.scrollLeft, m.clientWidth, 'right-zone click advances exactly one page');
  await zoneClick(page, 'back');
  m = await metrics(page);
  expectEq(m.scrollLeft, 0, 'left-zone click goes back exactly one page');

  await page.keyboard.press('Space');
  await page.waitForTimeout(80);
  m = await metrics(page);
  expectEq(m.scrollLeft, m.clientWidth, 'Space advances one page');
  await page.keyboard.press('PageDown');
  await page.waitForTimeout(80);
  m = await metrics(page);
  expectEq(m.scrollLeft, 2 * m.clientWidth, 'PageDown advances one page');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(80);
  m = await metrics(page);
  expectEq(m.scrollLeft, m.clientWidth, 'ArrowLeft goes back one page');
  await capture('page-turns');
});

scene('mode-invariance', async ({ page, capture }) => {
  // Deeper into the long chapter so the anchor has real work to do.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  const anchorId = await firstVisibleParagraph(page);
  expect(anchorId, 'a paragraph is visible at the page start');

  if (await chromeHidden(page)) await centerTap(page);
  await page.locator('#mode-toggle').click();
  await page.waitForTimeout(120);
  let m = await metrics(page);
  expectEq(m.overflowY, 'auto', 'toggle entered scroll mode');
  expect(m.scrollHeight > m.clientHeight, 'scroll mode has vertical extent');
  expectEq(
    await firstVisibleParagraph(page),
    anchorId,
    'LOAD-BEARING: the same paragraph sits at the viewport start after paged -> scroll',
  );
  const scrolled = await page.evaluate(() => {
    const v = document.getElementById('viewport') as HTMLElement;
    const before = v.scrollTop;
    v.scrollTop = before + 120;
    const moved = v.scrollTop !== before;
    v.scrollTop = before;
    return moved;
  });
  expect(scrolled, 'vertical scrolling works in scroll mode');
  await capture('scroll-mode');

  await page.locator('#mode-toggle').click();
  await page.waitForTimeout(120);
  m = await metrics(page);
  expectEq(m.overflowY, 'hidden', 'toggle returned to paged mode');
  expectEq(m.scrollLeft % m.clientWidth, 0, 'restore snapped to a page boundary');
  expectEq(
    await firstVisibleParagraph(page),
    anchorId,
    'LOAD-BEARING: the same paragraph sits at the page start after scroll -> paged',
  );
  await capture('back-to-paged');
});

scene('resume', async ({ page, capture }) => {
  const anchorId = await firstVisibleParagraph(page);
  expect(anchorId, 'have an anchor paragraph before reload');
  await page.waitForTimeout(1200); // debounced position save (800ms) + write
  await page.reload();
  await page.getByRole('heading', { name: 'Two: The Long Middle' }).waitFor();
  await page.waitForTimeout(200);
  const m = await metrics(page);
  expectEq(m.overflowY, 'hidden', 'reload reopens in paged mode');
  expectEq(
    await firstVisibleParagraph(page),
    anchorId,
    'reload restores the same paragraph at the page start',
  );
  await capture('resumed');
});

async function statusLeft(page: Page): Promise<string> {
  return (await page.locator('#status-cycle').textContent()) ?? '';
}

async function statusRight(page: Page): Promise<string> {
  return (await page.locator('#status-percent').textContent()) ?? '';
}

async function statusTap(page: Page): Promise<void> {
  await page.locator('#status-cycle').click();
  await page.waitForTimeout(60);
}

interface SyncedSidecar {
  progress: number;
  state: string;
  position?: { chapter: number; updatedAt: string };
  bookmarks?: { id: string; chapter: number; anchor: { path: number[]; ratio: number } }[];
}

/** The synced sidecar, read back through the dev lib endpoint (files are the contract). */
async function fetchSidecar(base: string): Promise<SyncedSidecar> {
  const index = (await (await fetch(`${base}/lib/library.json`)).json()) as {
    books: { dir: string }[];
  };
  const dir = index.books[0]?.dir;
  if (!dir) throw new Error('no book in the dev library');
  return (await (await fetch(`${base}/lib/${dir}/book.json`)).json()) as SyncedSidecar;
}

scene('chrome-rules', async ({ page, capture }) => {
  expect(await chromeHidden(page), 'chrome starts hidden after (re)open');
  await centerTap(page);
  expect(!(await chromeHidden(page)), 'center tap reveals chrome');
  await capture('chrome-open');
  await centerTap(page);
  expect(await chromeHidden(page), 'center tap hides chrome again');

  await centerTap(page); // reveal
  await zoneClick(page, 'forward');
  expect(await chromeHidden(page), 'a page turn hides revealed chrome');

  await centerTap(page); // reveal
  await page.locator('#toc-toggle').click();
  await page.locator('#toc').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await page.locator('#toc').isHidden(), 'Escape closes the open TOC panel');
  expect(!(await chromeHidden(page)), 'Escape leaves chrome open');

  await centerTap(page); // hide
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(!(await chromeHidden(page)), 'Escape with chrome hidden reveals it (never hides)');
  await capture('chrome-rules');
});

scene('status-cycle', async ({ page, base, capture }) => {
  // Chrome is open after the previous scene; the status strip shows only in
  // pure-text reading, so hide it first.
  await centerTap(page);
  expect(await chromeHidden(page), 'chrome hidden: the status strip is visible');

  // Initial state: time-left-chapter, still learning (no pace evidence yet).
  expectEq(
    await statusLeft(page),
    'Learning reading speed…',
    'time-left-chapter starts in the learning state',
  );
  const rightPct = await statusRight(page);
  expect(/^\d+%$/.test(rightPct), `right slot shows a percent (got "${rightPct}")`);
  await capture('status-learning');

  const before = await metrics(page);

  await statusTap(page); // -> time-left-book
  expectEq(await statusLeft(page), 'Learning reading speed…', 'time-left-book is also learning');

  await statusTap(page); // -> location
  const locText = await statusLeft(page);
  const loc = locText.match(/^Loc ([\d,]+) of ([\d,]+)$/);
  expect(loc, `location state shows "Loc X of Y" (got "${locText}")`);
  const locX = Number(loc[1]?.replace(/,/g, ''));
  const locY = Number(loc[2]?.replace(/,/g, ''));
  expect(locX >= 1 && locX <= locY, `Loc X within bounds (${locX} of ${locY})`);
  expect(locY > 50 && locY < 500, `location total is sane for the fixture (${locY})`);
  await capture('status-location');

  await statusTap(page); // -> page (the fixture has a page-list)
  const pageText = await statusLeft(page);
  expect(/^Page \d+ of 6$/.test(pageText), `page state shows "Page X of 6" (got "${pageText}")`);

  await statusTap(page); // -> percent
  const pctText = await statusLeft(page);
  expect(/^\d+%$/.test(pctText), `percent state shows a percent (got "${pctText}")`);
  await page.waitForTimeout(1200); // let the debounced position save flush
  const sidecar = await fetchSidecar(base);
  const saved = Math.round(sidecar.progress * 100);
  const shown = Number(pctText.replace('%', ''));
  expect(
    Math.abs(shown - saved) <= 1,
    `percent matches the saved progress within rounding (${shown}% vs ${saved}%)`,
  );
  expectEq(await statusRight(page), '', 'right slot empty when the left shows percent');

  await statusTap(page); // -> off
  expect(
    await page.evaluate(() =>
      document.getElementById('status-line')?.classList.contains('status-off'),
    ),
    'off state hides the strip',
  );
  expectEq(await statusLeft(page), '', 'off state shows no text');
  expectEq(await statusRight(page), '', 'off state shows no percent');

  await statusTap(page); // one more tap brings it back
  expectEq(
    await statusLeft(page),
    'Learning reading speed…',
    'a tap on the invisible target cycles back on',
  );

  const after = await metrics(page);
  expectEq(after.scrollLeft, before.scrollLeft, 'status taps never turn the page');
  expectEq(after.scrollTop, before.scrollTop, 'status taps never scroll');

  // Print page numbers march monotonically while reading through the book.
  await tocNav(page, 'Two: The Long Middle');
  await centerTap(page); // tocNav left chrome open; back to pure text
  for (let i = 0; i < 3; i++) await statusTap(page); // t-l-chapter -> ... -> page
  const pages: number[] = [];
  for (let i = 0; i < 15; i++) {
    const text = await statusLeft(page);
    const n = Number(text.match(/^Page (\d+) of 6$/)?.[1]);
    expect(Number.isFinite(n), `page state stays sane while turning (got "${text}")`);
    pages.push(n);
    if ((await chapterLabel(page)) === '3 of 3') break;
    await zoneClick(page, 'forward');
  }
  for (let i = 1; i < pages.length; i++) {
    const prev = pages[i - 1] ?? 0;
    const cur = pages[i] ?? 0;
    expect(cur >= prev, `page number never goes backwards (${pages.join(' -> ')})`);
  }
  expect((pages[0] ?? 99) <= 2, `starts near the front of the print edition (${pages[0]})`);
  expect((pages[pages.length - 1] ?? 0) >= 5, `reaches the back pages (${pages.join(' -> ')})`);
  await capture('status-page-numbers');
});

scene('finish-the-book', async ({ page, base, capture }) => {
  await tocNav(page, 'Three: An End');
  await centerTap(page); // tocNav left chrome open; drop back to pure text
  expectEq(await chapterLabel(page), '3 of 3', 'in the last chapter');

  // The fixture's last chapter is a single page, so the reader already sits
  // at the book's end: progress reports complete before any nudge.
  for (let i = 0; i < 7; i++) {
    if (/^Loc [\d,]+ of [\d,]+$/.test(await statusLeft(page))) break;
    await statusTap(page);
  }
  const endLoc = (await statusLeft(page)).match(/^Loc ([\d,]+) of ([\d,]+)$/);
  expect(endLoc, `status cycled to the location state (got "${await statusLeft(page)}")`);
  expectEq(endLoc[1], endLoc[2], 'the last page reads Loc Y of Y');
  expectEq(await statusRight(page), '100%', 'the last page reads 100%');

  const nudge = page.locator('#finish-nudge');
  expect(await nudge.isHidden(), 'no nudge before the boundary turn');

  // One more forward turn at the last page raises the nudge.
  await zoneClick(page, 'forward');
  expect(await nudge.isVisible(), 'forward at the book end nudges the finished state');
  expectEq(await chapterLabel(page), '3 of 3', 'gentle stop: still on the last page');
  await capture('finish-nudge');

  // It is a panel: Escape closes it before anything else.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await nudge.isHidden(), 'Escape closes the nudge');
  expect(await chromeHidden(page), 'Escape spent itself on the panel, chrome stays hidden');

  await zoneClick(page, 'forward');
  expect(await nudge.isVisible(), 'the nudge returns while the book is unfinished');
  await page.locator('#finish-not-yet').click();
  await page.waitForTimeout(80);
  expect(await nudge.isHidden(), '"Not yet" just closes the card');

  await zoneClick(page, 'forward');
  await page.locator('#finish-yes').click();
  await page.waitForTimeout(200);
  expect(
    await page.locator('#finish-confirm').isVisible(),
    'a quiet confirmation replaces the buttons',
  );
  await capture('finish-confirmed');
  await page.waitForTimeout(1600); // the card slips away on its own
  expect(await nudge.isHidden(), 'the card closes after confirming; the reader stays in the book');

  const sidecar = await fetchSidecar(base);
  expectEq(sidecar.state, 'finished', 'the synced sidecar records the finished state');
  expectEq(sidecar.progress, 1, 'the sidecar records progress 1 at the end');

  await zoneClick(page, 'forward');
  expect(await nudge.isHidden(), 'a finished book is never re-nudged');
  await capture('finished-book');
});

/** Ids of all paragraphs intersecting the viewport (the visible page). */
function visibleParagraphs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const v = document.getElementById('viewport') as HTMLElement;
    const wrapper = v.querySelector('.chapter-host')?.shadowRoot?.querySelector('.chapter');
    if (!wrapper) return [];
    const paged = getComputedStyle(v).overflowY === 'hidden';
    const vr = v.getBoundingClientRect();
    const out: string[] = [];
    for (const p of Array.from(wrapper.querySelectorAll('p[id]'))) {
      const r = p.getBoundingClientRect();
      const visible = paged
        ? r.right > vr.left + 1 && r.left < vr.right - 1
        : r.bottom > vr.top + 1 && r.top < vr.bottom - 1;
      if (visible) out.push(p.id);
    }
    return out;
  });
}

/** Computed style of the first paragraph inside the chapter shadow. */
async function chapterParagraphStyle(page: Page): Promise<{
  fontFamily: string;
  fontSizePx: number;
  fontWeight: string;
  lineHeightPx: number;
  textAlign: string;
}> {
  return await page.evaluate(() => {
    const p = document
      .querySelector('#viewport .chapter-host')
      ?.shadowRoot?.querySelector('.chapter p');
    if (!p) throw new Error('no paragraph in the chapter shadow');
    const s = getComputedStyle(p);
    return {
      fontFamily: s.fontFamily,
      fontSizePx: Number.parseFloat(s.fontSize),
      fontWeight: s.fontWeight,
      lineHeightPx: Number.parseFloat(s.lineHeight),
      textAlign: s.textAlign,
    };
  });
}

/** The paged column width the renderer derived, in px. */
async function columnWidth(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const wrapper = document
      .querySelector('#viewport .chapter-host')
      ?.shadowRoot?.querySelector('.chapter') as HTMLElement | null;
    if (!wrapper) throw new Error('no chapter wrapper');
    return Number.parseFloat(wrapper.style.getPropertyValue('--column-width'));
  });
}

scene('typography', async ({ page, capture }) => {
  // Deep into the long chapter so reflows have real position work to do.
  await tocNav(page, 'Deep in the middle');
  expect(!(await chromeHidden(page)), 'chrome is open before the Aa panel');

  await page.locator('#aa-toggle').click();
  await page.locator('#aa-panel').waitFor({ state: 'visible' });
  expect(!(await chromeHidden(page)), 'chrome stays open under the Aa panel');
  await capture('aa-panel');

  // Theme -> dark: ONE token source proves itself — the app shell, the meta
  // theme-color, and the book page inside the shadow all move together.
  await page.locator('#aa-panel [data-theme="dark"]').click();
  await page.waitForTimeout(80);
  const dark = await page.evaluate(() => {
    const host = document.querySelector('#viewport .chapter-host') as HTMLElement;
    const p = host.shadowRoot?.querySelector('.chapter p') as Element;
    return {
      rootTheme: document.documentElement.dataset.theme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hostBg: getComputedStyle(host).backgroundColor,
      pageFg: getComputedStyle(p).color,
      meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    };
  });
  expectEq(dark.rootTheme, 'dark', 'dark theme lands on the root element');
  expectEq(dark.hostBg, 'rgb(18, 18, 18)', 'the book page background follows the app token');
  expectEq(dark.bodyBg, dark.hostBg, 'app shell and shadow page share ONE bg token');
  expectEq(dark.pageFg, 'rgb(214, 211, 205)', 'book text color follows the theme');
  expectEq(dark.meta, '#121212', 'meta theme-color follows the theme');
  await capture('theme-dark');

  // Font -> Atkinson: the family flows through the shadow seam.
  await page.locator('.aa-font-atkinson').click();
  await page.waitForTimeout(120);
  let style = await chapterParagraphStyle(page);
  expect(
    style.fontFamily.includes('Atkinson'),
    `paragraphs render in Atkinson (got "${style.fontFamily}")`,
  );

  // Size +2: text grows AND the reading position survives the reflow.
  const beforeSize = style.fontSizePx;
  const beforeId = await firstVisibleParagraph(page);
  expect(beforeId, 'a paragraph is visible before the size change');
  await page.locator('#aa-size-up').click();
  await page.locator('#aa-size-up').click();
  await page.waitForTimeout(120);
  style = await chapterParagraphStyle(page);
  expect(
    style.fontSizePx > beforeSize,
    `font size grew (${beforeSize}px -> ${style.fontSizePx}px)`,
  );
  // The anchor point maps to the page CONTAINING it in the new pagination
  // (pages are a grid from the chapter start, so the point is generally
  // mid-page — Kindle behaves the same way). Preserved position therefore
  // means: the paragraph that led the old page is on the new visible page,
  // and the page never jumped ahead of it.
  const afterIds = await visibleParagraphs(page);
  expect(
    afterIds.includes(beforeId),
    `LOAD-BEARING: the page-start paragraph ${beforeId} is still on the visible page after the size reflow (visible: ${afterIds.join(' ')})`,
  );
  const firstAfter = afterIds[0] ?? '';
  expect(
    Number(firstAfter.slice(1)) <= Number(beforeId.slice(1)),
    `the reflowed page never jumps past the reading position (${firstAfter} vs ${beforeId})`,
  );
  await capture('size-up-dark');

  // An outside tap closes the panel and is swallowed: no page turn, no
  // chrome toggle. (It landed in what would be the back tap zone.)
  const beforeOutside = await metrics(page);
  await page.mouse.click(180, 400);
  await page.waitForTimeout(80);
  expect(await page.locator('#aa-panel').isHidden(), 'a tap outside closes the panel');
  const afterOutside = await metrics(page);
  expectEq(afterOutside.scrollLeft, beforeOutside.scrollLeft, 'the closing tap turns no page');
  expect(!(await chromeHidden(page)), 'the closing tap leaves chrome alone');
  await page.locator('#aa-toggle').click();
  await page.locator('#aa-panel').waitFor({ state: 'visible' });

  // Alignment -> justified, with hyphenation armed on the wrapper.
  await page.locator('#aa-align-justify').click();
  await page.waitForTimeout(120);
  style = await chapterParagraphStyle(page);
  expectEq(style.textAlign, 'justify', 'paragraphs justify');
  const hyphenation = await page.evaluate(() => {
    const wrapper = document
      .querySelector('#viewport .chapter-host')
      ?.shadowRoot?.querySelector('.chapter') as HTMLElement;
    return { hyphens: getComputedStyle(wrapper).hyphens, lang: wrapper.getAttribute('lang') };
  });
  expectEq(hyphenation.hyphens, 'auto', 'justification brings real hyphenation');
  expectEq(hyphenation.lang, 'en', 'the wrapper carries the book language for the hyphenator');

  // Weight and spacing steps apply live.
  await page.locator('#aa-weight-575').click();
  await page.waitForTimeout(80);
  style = await chapterParagraphStyle(page);
  expectEq(style.fontWeight, '575', 'the heavy weight step reaches the text');
  const beforeLeading = style.lineHeightPx;
  await page.locator('#aa-spacing-relaxed').click();
  await page.waitForTimeout(80);
  style = await chapterParagraphStyle(page);
  expect(
    style.lineHeightPx > beforeLeading,
    `relaxed spacing opens the leading (${beforeLeading}px -> ${style.lineHeightPx}px)`,
  );

  // Margins -> "Wide" (narrower text): the paged column narrows.
  const beforeColumn = await columnWidth(page);
  await page.locator('#aa-margins-wide').click();
  await page.waitForTimeout(120);
  const afterColumn = await columnWidth(page);
  expect(
    afterColumn < beforeColumn,
    `wide margins narrow the column (${beforeColumn}px -> ${afterColumn}px)`,
  );
  await capture('typography-tuned');

  // Reload: taste is device-local (C8) and all of it comes back.
  await page.reload();
  await page.getByRole('heading', { name: 'Two: The Long Middle' }).waitFor();
  await page.waitForTimeout(200);
  const restored = await page.evaluate(() => document.documentElement.dataset.theme);
  expectEq(restored, 'dark', 'reload restores the theme');
  expectEq(
    await page.evaluate(() =>
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    ),
    '#121212',
    'reload restores the meta theme-color',
  );
  style = await chapterParagraphStyle(page);
  expect(style.fontFamily.includes('Atkinson'), 'reload restores the font');
  expectEq(style.fontSizePx, 20.48, 'reload restores the size step (1.28rem)');
  await capture('typography-restored');

  // Back to the stock look so later scenes (and the next run) start clean.
  await centerTap(page);
  await page.locator('#aa-toggle').click();
  await page.locator('#aa-panel').waitFor({ state: 'visible' });
  await page.locator('#aa-panel [data-theme="paper"]').click();
  await page.locator('.aa-font-literata').click();
  await page.locator('#aa-size-down').click();
  await page.locator('#aa-size-down').click();
  await page.locator('#aa-weight-400').click();
  await page.locator('#aa-spacing-normal').click();
  await page.locator('#aa-margins-medium').click();
  await page.locator('#aa-align-left').click();
  await page.waitForTimeout(120);

  // Escape closes the panel BEFORE the TOC/chrome get a say (the panel chain).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await page.locator('#aa-panel').isHidden(), 'Escape closes the Aa panel');
  expect(!(await chromeHidden(page)), 'Escape spent itself on the panel; chrome stays open');

  style = await chapterParagraphStyle(page);
  expect(style.fontFamily.includes('Literata'), 'defaults restored: Literata');
  expectEq(style.fontSizePx, 16.8, 'defaults restored: size step 2 (1.05rem)');
  expectEq(style.textAlign, 'left', 'defaults restored: left alignment');
  expectEq(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'paper',
    'defaults restored: paper theme',
  );
  await centerTap(page); // back to pure text
  await capture('typography-defaults');
});

// --- Epic 4: annotations ---

interface MarkInfo {
  id: string;
  classes: string;
  text: string;
  hasNote: boolean;
}

/** All highlight marks in the rendered chapter shadow, in document order. */
function marksIn(page: Page): Promise<MarkInfo[]> {
  return page.evaluate(() => {
    const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
    if (!shadow) return [];
    return Array.from(shadow.querySelectorAll<HTMLElement>('mark.hl')).map((m) => ({
      id: m.dataset.hl ?? '',
      classes: m.className,
      text: m.textContent ?? '',
      hasNote: m.classList.contains('has-note'),
    }));
  });
}

/**
 * Select `needle` inside a paragraph by flattened-text offsets — the exact
 * path a reader's drag takes (window.getSelection().setBaseAndExtent works on
 * shadow text nodes in Chromium) — then let go (pointerup). Walks text nodes
 * so it works in an already-marked paragraph too.
 */
async function selectTextIn(page: Page, pid: string, needle: string): Promise<void> {
  await page.evaluate(
    ([pid, needle]) => {
      const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
      const p = shadow?.getElementById(pid);
      if (!p) throw new Error(`no paragraph #${pid}`);
      const flat = p.textContent ?? '';
      const from = flat.indexOf(needle);
      if (from < 0) throw new Error(`"${needle}" not in #${pid}`);
      const pointAt = (offset: number): { node: Node; off: number } => {
        let acc = 0;
        const walk = (node: Node): { node: Node; off: number } | null => {
          if (node.nodeType === 3) {
            const len = (node as Text).data.length;
            if (offset <= acc + len) return { node, off: offset - acc };
            acc += len;
            return null;
          }
          for (const child of Array.from(node.childNodes)) {
            const found = walk(child);
            if (found) return found;
          }
          return null;
        };
        const found = walk(p);
        if (!found) throw new Error('offset past paragraph text');
        return found;
      };
      const s = pointAt(from);
      const e = pointAt(from + needle.length);
      window.getSelection()?.setBaseAndExtent(s.node, s.off, e.node, e.off);
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    },
    [pid, needle] as const,
  );
  await page.locator('#selection-menu').waitFor({ state: 'visible' });
}

/** Click the middle of a highlight's first mark segment. */
async function clickMark(page: Page, id: string): Promise<void> {
  const point = await page.evaluate((id) => {
    const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
    const mark = shadow?.querySelector(`mark.hl[data-hl="${id}"]`);
    if (!mark) throw new Error(`no mark for highlight ${id}`);
    // First LINE box, not the bounding box: a mark wrapping across lines has
    // a union rect whose center can miss the text entirely.
    const r = mark.getClientRects()[0] ?? mark.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(120);
}

/** Marks tagged with a JS-only probe property: survives CSS relayouts only. */
function probeMarks(page: Page): Promise<{ count: number; sameNodes: boolean }> {
  return page.evaluate(() => {
    const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
    const marks = Array.from(shadow?.querySelectorAll('mark.hl') ?? []);
    return {
      count: marks.length,
      sameNodes: marks.every((m) => (m as HTMLElement & { __probe?: boolean }).__probe === true),
    };
  });
}

scene('highlight-persistence', async ({ page, capture }) => {
  await tocNav(page, 'Two: The Long Middle');
  await centerTap(page); // toc navigation leaves chrome open; back to text
  expectEq(await chapterLabel(page), '2 of 3', 'in chapter 2');

  // First highlight: yellow, mid-paragraph.
  await selectTextIn(page, 'p2', 'The quick brown fox');
  await page.locator('#selection-menu [data-color="yellow"]').click();
  await page.waitForTimeout(150);
  let marks = await marksIn(page);
  expectEq(marks.length, 1, 'one mark after the first highlight');
  expect(marks[0]?.classes.includes('hl-yellow'), 'the first highlight is yellow');
  expectEq(marks[0]?.text, 'The quick brown fox', 'the mark wraps exactly the selected text');
  expect(await page.locator('#selection-menu').isHidden(), 'the menu closes after highlighting');
  const firstId = marks[0]?.id ?? '';
  expect(firstId.length === 8, 'the mark carries its highlight id');

  // Second highlight in the SAME paragraph: pink. Its serialization must see
  // the mark-free structure even though the first mark split the text nodes
  // (salvage §1 — the bug class this scene exists for).
  await selectTextIn(page, 'p2', 'deliberately and at length');
  await page.locator('#selection-menu [data-color="pink"]').click();
  await page.waitForTimeout(150);
  marks = await marksIn(page);
  expectEq(marks.length, 2, 'two marks in the same paragraph');
  const secondId = marks.find((m) => m.classes.includes('hl-pink'))?.id ?? '';
  expect(secondId.length === 8, 'the pink highlight has its own id');

  // A dismissing tap closes the menu and is swallowed: no page turn, no
  // chrome toggle (the annotation layer owns that tap).
  await selectTextIn(page, 'p3', 'so that this chapter');
  const before = await metrics(page);
  await page.mouse.click(180, 400); // the back tap zone
  await page.waitForTimeout(150);
  expect(await page.locator('#selection-menu').isHidden(), 'an outside tap dismisses the menu');
  const after = await metrics(page);
  expectEq(after.scrollLeft, before.scrollLeft, 'the dismissing tap turns no page');
  expect(await chromeHidden(page), 'the dismissing tap leaves chrome hidden');

  // Attach a note to the first highlight through the edit menu.
  await clickMark(page, firstId);
  await page.locator('#selection-menu').waitFor({ state: 'visible' });
  await page.locator('#sel-note').click();
  await page.locator('#note-editor').waitFor({ state: 'visible' });
  await page.locator('#note-text').fill('the fox is load-bearing');
  await page.locator('#note-save').click();
  await page.waitForTimeout(200);
  marks = await marksIn(page);
  expect(marks.find((m) => m.id === firstId)?.hasNote, 'the note marker rides the yellow mark');
  await capture('highlights-created');

  // RELOAD: both highlights and the note marker restore from the sidecar.
  await page.waitForTimeout(600); // let the sidecar writes flush
  await page.reload();
  await page.getByRole('heading', { name: 'Two: The Long Middle' }).waitFor();
  await page.waitForTimeout(250);
  marks = await marksIn(page);
  expectEq(marks.length, 2, 'LOAD-BEARING: both highlights restore after reload');
  const yellow = marks.find((m) => m.id === firstId);
  const pink = marks.find((m) => m.id === secondId);
  expect(yellow?.classes.includes('hl-yellow'), 'the yellow highlight restores its color');
  expectEq(yellow?.text, 'The quick brown fox', 'the restored yellow covers the same text');
  expect(yellow?.hasNote, 'the note marker restores');
  expect(pink?.classes.includes('hl-pink'), 'the pink highlight restores its color');
  expectEq(pink?.text, 'deliberately and at length', 'the restored pink covers the same text');
  await capture('highlights-restored');

  // Mode switches relayout CSS only: the marks must be the SAME DOM nodes,
  // not re-applied copies.
  await page.evaluate(() => {
    const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
    for (const m of Array.from(shadow?.querySelectorAll('mark.hl') ?? [])) {
      (m as HTMLElement & { __probe?: boolean }).__probe = true;
    }
  });
  await centerTap(page);
  await page.locator('#mode-toggle').click(); // paged -> scroll
  await page.waitForTimeout(150);
  let probes = await probeMarks(page);
  expectEq(probes.count, 2, 'both marks present in scroll mode');
  expect(probes.sameNodes, 'paged -> scroll kept the same mark nodes (no re-application)');
  await page.locator('#mode-toggle').click(); // scroll -> paged
  await page.waitForTimeout(150);
  probes = await probeMarks(page);
  expectEq(probes.count, 2, 'both marks present back in paged mode');
  expect(probes.sameNodes, 'scroll -> paged kept the same mark nodes');
  await centerTap(page); // hide chrome again

  // Delete: a throwaway blue highlight is removed and the paragraph's DOM
  // returns byte-identical (unwrap + normalize).
  const pristine = await page.evaluate(
    () =>
      document.querySelector('#viewport .chapter-host')?.shadowRoot?.getElementById('p3')
        ?.innerHTML ?? '',
  );
  await selectTextIn(page, 'p3', 'position anchors have real work');
  await page.locator('#selection-menu [data-color="blue"]').click();
  await page.waitForTimeout(150);
  marks = await marksIn(page);
  expectEq(marks.length, 3, 'a third (blue) highlight exists');
  const blueId = marks.find((m) => m.classes.includes('hl-blue'))?.id ?? '';
  await clickMark(page, blueId);
  await page.locator('#selection-menu').waitFor({ state: 'visible' });
  await page.locator('#sel-delete').click();
  await page.waitForTimeout(150);
  marks = await marksIn(page);
  expectEq(marks.length, 2, 'delete removes the blue highlight');
  const p3state = await page.evaluate(() => {
    const p = document.querySelector('#viewport .chapter-host')?.shadowRoot?.getElementById('p3');
    return { html: p?.innerHTML ?? '', nodes: p?.childNodes.length ?? 0 };
  });
  expectEq(p3state.html, pristine, 'delete + normalize restores the pristine paragraph');
  expectEq(p3state.nodes, 1, 'the split text nodes re-fused into one');
  await page.waitForTimeout(400); // let the delete write flush before reuse
  await capture('highlight-deleted');
});

/** Viewport point at the middle of a word's first rendered rect. */
function wordPoint(page: Page, pid: string, word: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([pid, word]) => {
      const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
      const p = shadow?.getElementById(pid);
      if (!p) throw new Error(`no paragraph #${pid}`);
      const flat = p.textContent ?? '';
      const from = flat.indexOf(word);
      if (from < 0) throw new Error(`"${word}" not in #${pid}`);
      let acc = 0;
      let node: Text | null = null;
      let off = 0;
      const walk = (n: Node): boolean => {
        if (n.nodeType === 3) {
          const len = (n as Text).data.length;
          if (from < acc + len) {
            node = n as Text;
            off = from - acc;
            return true;
          }
          acc += len;
          return false;
        }
        for (const child of Array.from(n.childNodes)) {
          if (walk(child)) return true;
        }
        return false;
      };
      walk(p);
      if (!node) throw new Error('word offset unresolved');
      const probe = document.createRange();
      probe.setStart(node, off);
      probe.setEnd(node, Math.min(off + word.length, (node as Text).data.length));
      const rect = probe.getClientRects()[0];
      if (!rect) throw new Error('word has no rect');
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    [pid, word] as const,
  );
}

const dictFetches = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __dictFetches: number }).__dictFetches);

scene('dictionary', async ({ page, capture }) => {
  // Harness hook: count artifact fetches issued by the page.
  await page.evaluate(() => {
    const w = window as unknown as { __dictFetches: number; fetch: typeof fetch };
    w.__dictFetches = 0;
    const orig = w.fetch.bind(window);
    w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/dict/')) w.__dictFetches += 1;
      return orig(input, init);
    }) as typeof fetch;
  });

  // Double-click a word (desktop trigger): the card pops with a definition.
  const point = await wordPoint(page, 'p1', 'quick');
  await page.mouse.dblclick(point.x, point.y);
  await page.locator('#dict-card[data-state="hit"]').waitFor();
  expectEq(await page.locator('#dict-headword').textContent(), 'quick', 'headword is the word');
  const body = (await page.locator('#dict-body').textContent()) ?? '';
  expect(body.includes('Alive'), `a real Webster definition renders (got "${body.slice(0, 40)}…")`);
  expectEq(
    await page.locator('#dict-wiki').getAttribute('href'),
    'https://en.wikipedia.org/wiki/Special:Search?search=quick',
    'the Wikipedia off-ramp targets the word',
  );
  expectEq(await dictFetches(page), 1, 'the first lookup fetched the artifact');
  await capture('dictionary-card');

  // Escape closes the card FIRST in the chain (before menu/panels/chrome).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await page.locator('#dict-card').isHidden(), 'Escape closes the dictionary card');
  if (!(await page.locator('#selection-menu').isHidden())) {
    await page.keyboard.press('Escape'); // the word-selection menu is next
    await page.waitForTimeout(80);
  }
  expect(await page.locator('#selection-menu').isHidden(), 'the selection menu is closed too');

  // Folded lookup through the menu's Look up: "jumps" resolves to "jump".
  await selectTextIn(page, 'p1', 'jumps');
  await page.locator('#sel-lookup').click();
  await page.locator('#dict-card[data-state="hit"]').waitFor();
  expectEq(
    await page.locator('#dict-headword').textContent(),
    'jumps → jump',
    'a folded match shows its provenance',
  );
  const jumpBody = (await page.locator('#dict-body').textContent()) ?? '';
  expect(jumpBody.includes('spring'), 'the folded headword brings its definition');
  // LOAD-BEARING for offline: the resident map answers, no second fetch.
  expectEq(await dictFetches(page), 1, 'a second lookup does not re-fetch the artifact');
  await capture('dictionary-folded');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await page.locator('#dict-card').isHidden(), 'the card closes cleanly');
  if (!(await chromeHidden(page))) await centerTap(page); // back to pure text
});

// --- Epic 4: the notebook and deep links ---

interface NotebookRow {
  id: string;
  color: string;
  text: string;
  note: string | null;
  chapter: string;
}

/** The notebook panel's rows, in the order it lists them. */
function notebookRows(page: Page): Promise<NotebookRow[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#notebook .nb-row')).map((row) => ({
      id: row.dataset.hl ?? '',
      color: row.querySelector('.nb-dot')?.className.match(/hl-dot-(\w+)/)?.[1] ?? '',
      text: row.querySelector('.nb-text')?.textContent ?? '',
      note: row.querySelector('.nb-note')?.textContent ?? null,
      chapter: row.querySelector('.nb-chapter')?.textContent ?? '',
    })),
  );
}

/** Where a highlight's mark sits, and whether it is flashing right now. */
function markState(
  page: Page,
  id: string,
): Promise<{ present: boolean; inViewport: boolean; flashed: boolean }> {
  return page.evaluate((id) => {
    const v = document.getElementById('viewport') as HTMLElement;
    const mark = v
      .querySelector('.chapter-host')
      ?.shadowRoot?.querySelector(`mark.hl[data-hl="${id}"]`);
    if (!mark) return { present: false, inViewport: false, flashed: false };
    const r = mark.getBoundingClientRect();
    const vr = v.getBoundingClientRect();
    return {
      present: true,
      inViewport: r.right > vr.left && r.left < vr.right && r.bottom > vr.top && r.top < vr.bottom,
      flashed: mark.classList.contains('hl-flash'),
    };
  }, id);
}

async function openNotebook(page: Page): Promise<void> {
  if (await chromeHidden(page)) await centerTap(page);
  await page.locator('#notebook-toggle').click();
  await page.locator('#notebook').waitFor({ state: 'visible' });
}

scene('notebook-and-links', async ({ page, capture }) => {
  // A third highlight, in ANOTHER chapter: the notebook has to name each
  // chapter from the toc, and a jump has to really cross chapters.
  await tocNav(page, 'Three: An End');
  await centerTap(page);
  expectEq(await chapterLabel(page), '3 of 3', 'in chapter 3');
  await selectTextIn(page, 'c3', 'An End');
  await page.locator('#selection-menu [data-color="orange"]').click();
  await page.waitForTimeout(200);
  const orangeId = (await marksIn(page)).find((m) => m.classes.includes('hl-orange'))?.id ?? '';
  expect(orangeId.length === 8, 'an orange highlight now lives in chapter 3');

  // The panel: every highlight in the book, in book order, named by chapter.
  await openNotebook(page);
  const rows = await notebookRows(page);
  expectEq(rows.length, 3, 'the notebook lists every highlight in the book');
  expectEq(
    rows.map((r) => r.text).join(' / '),
    'The quick brown fox / deliberately and at length / An End',
    'rows are in BOOK order (chapter, then position) — never creation order',
  );
  expectEq(rows.map((r) => r.color).join(','), 'yellow,pink,orange', 'each row wears its color');
  expectEq(rows[0]?.chapter, 'Two: The Long Middle', 'the chapter title comes from the toc');
  expectEq(rows[1]?.chapter, 'Two: The Long Middle', 'both chapter-2 highlights name chapter 2');
  expectEq(rows[2]?.chapter, 'Three: An End', 'the chapter-3 highlight names chapter 3');
  expectEq(rows[0]?.note, 'the fox is load-bearing', 'the note rides its highlight');
  expectEq(rows[1]?.note, null, 'a note-less highlight shows no note line');
  const yellowId = rows[0]?.id ?? '';
  await capture('notebook-panel');

  // Color filters narrow the list; a color nobody used shows the empty state.
  await page.locator('#notebook [data-filter="pink"]').click();
  const filtered = await notebookRows(page);
  expectEq(filtered.length, 1, 'the pink filter narrows the list to one row');
  expectEq(filtered[0]?.text, 'deliberately and at length', 'and it is the pink highlight');
  await capture('notebook-filtered');
  await page.locator('#notebook [data-filter="blue"]').click();
  expectEq((await notebookRows(page)).length, 0, 'a color with no highlights lists nothing');
  expectEq(
    await page.locator('#notebook .nb-empty').textContent(),
    'Nothing highlighted yet.',
    'the empty state says so plainly',
  );
  await page.locator('#notebook [data-filter="all"]').click();
  expectEq((await notebookRows(page)).length, 3, 'All restores the whole list');

  // Export: one markdown outline per book, ready to drop into Logseq.
  const linkBase = await page.evaluate(
    () => `${location.origin}${location.pathname}${location.search}`,
  );
  const bookId = await page.evaluate(() => location.hash.match(/#\/book\/([0-9a-f]+)/)?.[1] ?? '');
  const link = (hid: string): string => `${linkBase}#/book/${bookId}/hl/${hid}`;
  const expected = `${[
    '# The Fixture of Everything',
    '- The quick brown fox',
    '  - Two: The Long Middle',
    `  - [link](${link(yellowId)})`,
    '  - note: the fox is load-bearing',
    '- deliberately and at length',
    '  - Two: The Long Middle',
    `  - [link](${link(rows[1]?.id ?? '')})`,
    '- An End',
    '  - Three: An End',
    `  - [link](${link(orangeId)})`,
  ].join('\n')}\n`;
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#notebook-export').click(),
  ]);
  expectEq(
    download.suggestedFilename(),
    'the-fixture-of-everything-highlights.md',
    'the export is named after the book',
  );
  expectEq(
    readFileSync(await download.path(), 'utf8'),
    expected,
    'LOAD-BEARING: the outline matches bullet for bullet, links and all',
  );

  // Escape closes the notebook and nothing else; the sibling panels take
  // turns (chain order: cards/menus, notebook, Aa, toc, chrome).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await page.locator('#notebook').isHidden(), 'Escape closes the notebook');
  expect(!(await chromeHidden(page)), 'Escape closing the notebook left the chrome alone');
  await openNotebook(page);
  await page.locator('#aa-toggle').click();
  await page.waitForTimeout(80);
  expect(await page.locator('#notebook').isHidden(), 'opening the Aa panel closes the notebook');
  await page.keyboard.press('Escape');
  await openNotebook(page);
  await page.locator('#toc-toggle').click();
  await page.waitForTimeout(80);
  expect(await page.locator('#notebook').isHidden(), 'opening the toc closes the notebook');
  await page.locator('#toc-toggle').click(); // and away again

  // A row jump: out of chapter 3, into the yellow highlight in chapter 2.
  await openNotebook(page);
  await page.locator(`#notebook .nb-row[data-hl="${yellowId}"]`).click();
  await page.waitForTimeout(200);
  expectEq(await chapterLabel(page), '2 of 3', 'the row jumped to the highlight’s chapter');
  expect(await page.locator('#notebook').isHidden(), 'the notebook closes behind the jump');
  let state = await markState(page, yellowId);
  expect(state.inViewport, 'the jump brought the highlight on screen');
  expect(state.flashed, 'landing on a highlight flashes it');
  await capture('notebook-jump');

  // Copy link on the chapter-3 highlight, then park the reading position in
  // chapter 1: a fresh page must jump to the LINK, not to the saved place.
  await tocNav(page, 'Three: An End');
  await centerTap(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await clickMark(page, orangeId);
  await page.locator('#sel-copy-link').click();
  await page.waitForTimeout(120);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expectEq(copied, link(orangeId), 'Copy link yields the absolute highlight deep link');

  await tocNav(page, 'One: A Beginning');
  await centerTap(page);
  await page.waitForTimeout(500); // let the position write land

  const fresh = await page.context().newPage();
  await fresh.goto(copied);
  await fresh.getByRole('heading', { name: 'Three: An End' }).waitFor();
  // The flash is transient (1s): wait for it rather than sampling once.
  await fresh.waitForFunction(() => {
    const shadow = document.querySelector('#viewport .chapter-host')?.shadowRoot;
    return !!shadow?.querySelector('mark.hl.hl-flash');
  });
  expectEq(
    await chapterLabel(fresh),
    '3 of 3',
    'a cold-opened deep link lands in the right chapter',
  );
  state = await markState(fresh, orangeId);
  expect(state.inViewport, 'the deep-linked highlight is on screen, flashed');
  expectEq(
    await fresh.evaluate(() => location.hash),
    `#/book/${bookId}/hl/${orangeId}`,
    'the address bar keeps the deep link (still copyable)',
  );
  await fresh.close();

  // The same link in the page we have been driving, for the evidence shot.
  await page.goto(copied);
  await page.getByRole('heading', { name: 'Three: An End' }).waitFor();
  await page.waitForTimeout(150);
  expect((await markState(page, orangeId)).present, 'the deep link restores the highlight’s mark');
  await capture('notebook-deep-link');
});

// --- Epic 5: navigation and chrome ---

/** Tap the top-right bookmark corner of the page (parity G1). */
async function cornerTap(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const r = (document.getElementById('viewport') as HTMLElement).getBoundingClientRect();
    return { x: r.right - 20, y: r.top + 20 };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(120);
}

function ribbonShown(page: Page): Promise<boolean> {
  return page.evaluate(() => !(document.getElementById('bookmark-ribbon') as HTMLElement).hidden);
}

scene('bookmarks', async ({ page, base, capture }) => {
  // Off the previous scene's deep link and back onto the plain book route, so
  // a reload later in this scene resumes rather than re-following the link.
  await page.evaluate(() => {
    location.hash = location.hash.replace(/\/hl\/[0-9a-f]+$/, '');
  });
  await page.waitForTimeout(300);
  await tocNav(page, 'Two: The Long Middle');
  await centerTap(page); // tocNav leaves chrome open; the corner lives on the page
  expect(!(await ribbonShown(page)), 'no dog-ear on an unbookmarked page');

  // The corner gesture: a tap where a forward turn would otherwise happen.
  const before = await metrics(page);
  await cornerTap(page);
  expect(await ribbonShown(page), 'a corner tap raises the dog-ear ribbon');
  const after = await metrics(page);
  expectEq(after.scrollLeft, before.scrollLeft, 'the corner tap never turns the page');

  await zoneClick(page, 'forward');
  expect(!(await ribbonShown(page)), 'turning away from the page hides the ribbon');
  await zoneClick(page, 'back');
  expect(await ribbonShown(page), 'turning back to the bookmarked page brings it back');
  await capture('bookmark-ribbon');

  // Tapping the corner again removes it (Kindle's toggle).
  await cornerTap(page);
  expect(!(await ribbonShown(page)), 'a second corner tap removes the bookmark');
  await cornerTap(page); // and back on, to keep for the Go To panel

  // A second bookmark, two pages on.
  await zoneClick(page, 'forward');
  await zoneClick(page, 'forward');
  await cornerTap(page);
  expect(await ribbonShown(page), 'a second page carries its own bookmark');

  // LOAD-BEARING: bookmarks are place, so they live in the SYNCED sidecar.
  await page.waitForTimeout(1200); // bookmark writes are immediate; the position save is debounced
  const sidecar = await fetchSidecar(base);
  expectEq(sidecar.bookmarks?.length, 2, 'both bookmarks reached the synced sidecar');
  expect(
    sidecar.bookmarks?.every((b) => b.chapter === 1 && Array.isArray(b.anchor.path)),
    'each bookmark carries its chapter and a structural anchor',
  );

  // Reload: the dog-ear comes back with the page, from the sidecar.
  await page.reload();
  await page.getByRole('heading', { name: 'Two: The Long Middle' }).waitFor();
  await page.waitForTimeout(250);
  expect(await ribbonShown(page), 'the ribbon restores after reload on the same page');
  await zoneClick(page, 'back');
  expect(!(await ribbonShown(page)), 'and is absent on the page before it');
  await capture('bookmark-restored');
});

async function openGoTo(page: Page): Promise<void> {
  if (await chromeHidden(page)) await centerTap(page);
  await page.locator('#toc-toggle').click();
  await page.locator('#goto-panel').waitFor({ state: 'visible' });
}

/** The status line's location number, cycling the strip to it if needed. */
async function statusLocation(page: Page): Promise<number> {
  if (!(await chromeHidden(page))) await centerTap(page);
  for (let i = 0; i < 7; i++) {
    const match = (await statusLeft(page)).match(/^Loc ([\d,]+) of ([\d,]+)$/);
    if (match) return Number(match[1]?.replace(/,/g, ''));
    await statusTap(page);
  }
  throw new Error('status never reached the location state');
}

interface BookmarkRow {
  id: string;
  chapter: string;
  snippet: string;
  date: string;
}

function bookmarkRows(page: Page): Promise<BookmarkRow[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#goto-bookmarks .goto-bm-row')).map(
      (row) => ({
        id: row.dataset.bookmark ?? '',
        chapter: row.querySelector('.goto-bm-chapter')?.textContent ?? '',
        snippet: row.querySelector('.goto-bm-snippet')?.textContent ?? '',
        date: row.querySelector('.goto-bm-date')?.textContent ?? '',
      }),
    ),
  );
}

scene('go-to', async ({ page, capture }) => {
  await openGoTo(page);
  expect(
    await page.locator('#toc a', { hasText: 'Two: The Long Middle' }).isVisible(),
    'the contents still live in the panel, unchanged',
  );
  await capture('go-to-panel');

  // Bookmarks: the two set in the previous scene, each described by what is
  // actually on that page — resolved from the anchor without rendering it.
  const rows = await bookmarkRows(page);
  expectEq(rows.length, 2, 'both bookmarks are listed');
  expectEq(rows[0]?.chapter, 'Two: The Long Middle', 'each row names its chapter, not an index');
  expect(
    (rows[0]?.snippet ?? '').includes('Paragraph'),
    `the row shows the text at the bookmark (got "${rows[0]?.snippet}")`,
  );
  expect(/^\d+ \w+ \d{4}$/.test(rows[1]?.date ?? ''), `rows carry a date (got "${rows[1]?.date}")`);
  expect(rows[0]?.snippet !== rows[1]?.snippet, 'the two bookmarks describe different pages');

  // Location entry. A page spans many locations, so landing "at" location 40
  // means landing on the PAGE that holds it: the status reads at or before it,
  // and one more turn reads past it.
  const target = 40;
  await page.locator('#goto-location').fill(String(target));
  await page.locator('#goto-location-go').click();
  await page.waitForTimeout(250);
  expect(await page.locator('#goto-panel').isHidden(), 'the panel closes behind the jump');
  const landed = await statusLocation(page);
  await zoneClick(page, 'forward');
  const nextPage = await statusLocation(page);
  expect(
    landed <= target && nextPage > target,
    `location entry lands on the page holding location ${target} (${landed} ≤ ${target} < ${nextPage})`,
  );
  await zoneClick(page, 'back');
  await capture('go-to-location');

  // The fixture carries a page-list, so a print page label wins over reading
  // the same characters as a location number.
  await openGoTo(page);
  await page.locator('#goto-location').fill('5');
  await page.locator('#goto-location-go').click();
  await page.waitForTimeout(250);
  await centerTap(page);
  // The fixture's print page 5 starts at #p55, so landing with that paragraph
  // on screen means the label branch won. Read as a LOCATION instead, "5"
  // would have landed near the very start of the book.
  expect(
    (await visibleParagraphs(page)).includes('p55'),
    'entering “5” goes to PRINT page 5, not to location 5',
  );

  // A bookmark row jumps to its page — proven by the dog-ear reappearing.
  await openGoTo(page);
  const first = (await bookmarkRows(page))[0];
  expect(first, 'a bookmark row to jump to');
  await page
    .locator(`#goto-bookmarks .goto-bm-row[data-bookmark="${first.id}"] .goto-bm-main`)
    .click();
  await page.waitForTimeout(250);
  await centerTap(page); // the jump left chrome open; back to pure text
  expect(await ribbonShown(page), 'the bookmark row landed on the bookmarked page');
  await capture('go-to-bookmark');

  // Cover: the top of the first chapter, wherever you were.
  await openGoTo(page);
  await page.locator('#goto-cover').click();
  await page.waitForTimeout(250);
  expectEq(await chapterLabel(page), '1 of 3', 'Cover goes to the first spine chapter');
  const m = await metrics(page);
  expectEq(m.scrollLeft, 0, 'and to its first page');

  // Beginning: this fixture declares no bodymatter landmark, so it honestly
  // falls back to the same place rather than guessing at front matter.
  await openGoTo(page);
  await page.locator('#goto-beginning').click();
  await page.waitForTimeout(250);
  expectEq(
    await chapterLabel(page),
    '1 of 3',
    'Beginning falls back to chapter 1 with no landmark',
  );

  // A location the book does not have is refused in place, with the panel open.
  await openGoTo(page);
  await page.locator('#goto-location').fill('99999');
  await page.locator('#goto-location-go').click();
  await page.waitForTimeout(120);
  expect(await page.locator('#goto-panel').isVisible(), 'a bad entry leaves the panel open');
  expect(
    ((await page.locator('#goto-error').textContent()) ?? '').includes('99999'),
    'and says plainly that there is nothing there',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  expect(await page.locator('#goto-panel').isHidden(), 'Escape closes the Go To panel');
  await centerTap(page);
});
