// The page-model acceptance scenes (Epic 1). Each scene asserts load-bearing
// behavior before capturing evidence; the worst rendering bugs (zero-width
// pagination, mode-switch position loss) are only catchable this way.

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

/** The synced sidecar, read back through the dev lib endpoint (files are the contract). */
async function fetchSidecar(base: string): Promise<{ progress: number; state: string }> {
  const index = (await (await fetch(`${base}/lib/library.json`)).json()) as {
    books: { dir: string }[];
  };
  const dir = index.books[0]?.dir;
  if (!dir) throw new Error('no book in the dev library');
  return (await (await fetch(`${base}/lib/${dir}/book.json`)).json()) as {
    progress: number;
    state: string;
  };
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
