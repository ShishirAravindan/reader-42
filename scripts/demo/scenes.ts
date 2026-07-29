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
