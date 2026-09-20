// The product pitch.
//
//   LIBRARY_DIR=… KOREADER=… DISPLAY=:99 bun scripts/demo/pitch.showcase.ts
//
// Three kinds of footage in one reel: the real shelf driven in a real browser,
// real KOReader captured off the X display it actually runs on, and the screens
// that do not exist yet, labelled as such on the page itself.
//
// The order is the argument. A folder with no index. A shelf that reads it. The
// handoff, and then the thing that actually reads — unmodified, not ours. What
// came back. And then the afterpage, which is the whole point: a reward for
// having read, assembled out of fields that were already sitting on disk.
//
// Everything before the "not built yet" stamp is working software. Nothing in
// this script stages data; the sidecar it reads was written by a real reading
// session, by something that did not know it was being filmed.

import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { launchChromium, waitForServer } from './harness.ts';
import {
  hush,
  installOverlay,
  narration,
  say,
  sayOver,
  startNarration,
  tapSelector,
} from './narrate.ts';
import { type Segment, assemble, recordDisplay } from './reel.ts';

const OUT = path.join(import.meta.dir, 'out');
const WORK = path.join(OUT, 'pitch');
const VIDEO = { width: 1280, height: 800 };
const BASE = `http://localhost:${process.env.PORT ?? 4310}`;
const DISPLAY = process.env.DISPLAY ?? ':99';
const KO_SIZE = { width: 1000, height: 1400 };
const LIBRARY = process.env.LIBRARY_DIR ?? '';
const KOREADER = process.env.KOREADER ?? '';
const headed = process.argv.includes('--headed');

mkdirSync(WORK, { recursive: true });
for (const old of readdirSync(WORK)) rmSync(path.join(WORK, old), { force: true });

const CARD_CSS = `
  #card {
    position: fixed; inset: 0; z-index: 2147483646;
    display: grid; place-items: center; text-align: center;
    background: #12110f; color: #e9e5da;
    opacity: 0; transition: opacity 420ms ease;
    font-family: Literata, Georgia, serif;
  }
  #card.on { opacity: 1; }
  #card:not(.on) { pointer-events: none; }
  #card .inner { max-width: 44rem; padding: 0 2rem; }
  #card h1 { font-size: 2.2rem; font-weight: 600; margin: 0 0 1.2rem; letter-spacing: -0.01em; }
  #card p { font-size: 1.1rem; line-height: 1.6; color: #b8b2a4; margin: 0; }
  #card pre {
    text-align: left; margin: 0; color: #e9e5da;
    font: 400 0.95rem/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  #card .dim { color: #8b8578; }
`;

async function card(page: Page, html: string): Promise<void> {
  await page.addStyleTag({ content: CARD_CSS });
  await page.evaluate((body: string) => {
    let host = document.getElementById('card');
    if (!host) {
      host = document.createElement('div');
      host.id = 'card';
      document.body.appendChild(host);
    }
    host.innerHTML = `<div class="inner">${body}</div>`;
    host.classList.add('on');
  }, html);
  await page.waitForTimeout(500);
}

async function uncard(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('card')?.classList.remove('on'));
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('card')?.remove());
}

/** The folder, as a shell listing: the argument is that this is all there is. */
function listing(): string {
  const lines = [`<span class="dim">$ ls "${path.basename(LIBRARY)}/"</span>`, ''];
  for (const entry of readdirSync(LIBRARY).sort()) {
    lines.push(
      entry.endsWith('.sdr') ? `${entry}/  <span class="dim">→ metadata.epub.lua</span>` : entry,
    );
  }
  lines.push('', '<span class="dim"># no library.json. no book.json. no import.</span>');
  return `<pre>${lines.join('\n')}</pre>`;
}

/** Record one browser act, returning its video and the lines spoken in it. */
async function browserAct(browser: Browser, act: (page: Page) => Promise<void>): Promise<Segment> {
  const context = await browser.newContext({
    viewport: VIDEO,
    recordVideo: { dir: WORK, size: VIDEO },
  });
  const page = await context.newPage();
  startNarration(true);
  await page.goto(BASE);
  await page.locator('#shelf-list li').first().waitFor({ timeout: 20000 });
  await installOverlay(page);
  await act(page);
  const lines = narration();
  const video = page.video();
  await context.close();
  const file = video ? await video.path() : '';
  return { video: file, lines };
}

const xdo = (...args: string[]): void => {
  Bun.spawnSync(['xdotool', ...args], { env: { ...process.env, DISPLAY } });
};

const koWindowUp = (): boolean =>
  Bun.spawnSync(['xdotool', 'search', '--name', 'KOReader'], {
    env: { ...process.env, DISPLAY },
  }).exitCode === 0;

async function main(): Promise<void> {
  if (!LIBRARY || !KOREADER) {
    console.error('LIBRARY_DIR and KOREADER must both be set');
    process.exit(2);
  }
  await waitForServer(`${BASE}/`);
  const browser = await launchChromium(!headed);
  const segments: Segment[] = [];

  // --- Act I: the premise, the folder, the shelf, the handoff ---
  segments.push(
    await browserAct(browser, async (page) => {
      await card(
        page,
        '<h1>reader-42</h1><p>This was a from-scratch e-reader. Fifteen thousand lines of it.</p>',
      );
      await say(page, 'reader-42 set out to build an exceptional e-reader from scratch.', 3400);
      await say(page, 'Then we noticed something already reads better than it ever would.', 3600);
      await hush(page);

      await card(page, listing());
      await say(page, 'So the library became a folder that KOReader owns.', 3200);
      await say(page, 'E-pubs, and the sidecars the device writes beside them.', 3200);
      await say(page, 'No index. No import step. No format of our own.', 3400);
      await hush(page);
      await uncard(page);

      await say(page, 'reader-42 reads that folder, and makes a shelf of it.', 3400);
      await say(page, 'Covers out of the e-pubs. Everything else from the device.', 3400);
      await hush(page, 900);

      await say(page, 'Open a book, and here is the whole posture in one moment.', 3200);
      await tapSelector(page, '#ondeck-list li', 1200);
      await say(page, 'It does not open books. It hands them to the thing that does.', 3800);
      await page.waitForTimeout(1800);
      await hush(page);
    }),
  );

  // --- Act II: the thing that actually reads ---
  const koSegment: Segment = { video: path.join(WORK, 'koreader.mp4'), lines: [] };
  startNarration(true);
  await recordDisplay(DISPLAY, KO_SIZE, koSegment.video, async () => {
    // The handoff in Act I already launched it; give it a moment to arrive.
    for (let i = 0; i < 40 && !koWindowUp(); i++) await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 2500));

    // KOReader opens in a 600x800 window on a 1000x1400 screen, so filming the
    // screen and then letterboxing it into a landscape frame shrinks the page
    // twice. Fill the display first; it repaints and reflows to the new size.
    const window = Bun.spawnSync(['xdotool', 'search', '--name', 'KOReader'], {
      env: { ...process.env, DISPLAY },
    })
      .stdout.toString()
      .trim()
      .split('\n')[0];
    if (window) {
      xdo('windowsize', window, String(KO_SIZE.width), String(KO_SIZE.height));
      xdo('windowmove', window, '0', '0');
      await new Promise((r) => setTimeout(r, 2500));
    }

    await sayOver('This is KOReader. Unmodified, unforked, not ours.', 3600);
    await sayOver('A decade of reading ergonomics we will never have to write.', 3800);

    // Turn some pages: right third forward, the way a reader taps.
    for (let i = 0; i < 3; i++) {
      xdo('mousemove', '830', '700', 'click', '1');
      await new Promise((r) => setTimeout(r, 1400));
    }
    await sayOver('Justified, hyphenated, and instant. Nothing here is a compromise.', 4000);
    await new Promise((r) => setTimeout(r, 1200));

    await sayOver('Everything you do here is written to a file beside the book.', 4000);
    await new Promise((r) => setTimeout(r, 1200));

    // Close it for real. KOReader flushes its sidecar on the way out, which is
    // the whole mechanism — so the next act is not a claim, it is the file.
    await sayOver('So close it.', 2200);
    Bun.spawnSync(['pkill', '-TERM', '-f', 'reader\\.lua']);
    for (let i = 0; i < 20 && koWindowUp(); i++) await new Promise((r) => setTimeout(r, 500));
    await new Promise((r) => setTimeout(r, 1500));
  });
  koSegment.lines = narration();
  segments.push(koSegment);

  // --- Act III: what came back, and the afterpage ---
  segments.push(
    await browserAct(browser, async (page) => {
      await say(page, 'Close it, and the library knows what happened.', 3200);
      await say(page, 'Progress, highlights, notes, the reading state — all of it.', 3600);
      await hush(page, 800);

      await say(page, 'And it says how fresh it is, rather than implying it.', 3400);
      await page.locator('#freshness').scrollIntoViewIfNeeded();
      await page.waitForTimeout(1400);
      await hush(page);

      // The payoff. Dwell here.
      await say(page, 'Now the part that makes this a library rather than a file browser.', 3800);
      await tapSelector(page, '#read-list li', 1600);
      await say(page, 'A finished book does not vanish. It leaves an afterpage.', 3800);
      await page.waitForTimeout(1600);

      await say(page, 'Four stars — which you gave it on the device, not here.', 3600);
      await page.waitForTimeout(1200);
      await say(page, 'Your own sentence about the book, written the day you finished.', 3800);
      await page.waitForTimeout(1600);
      await say(page, 'And every passage you marked, in the order the book put them.', 3800);
      await page.locator('#after-marks').scrollIntoViewIfNeeded();
      await page.waitForTimeout(2200);

      await say(page, 'None of this required a single change to KOReader.', 3800);
      await say(page, 'It was all already on disk. The shelf simply had to read it.', 4000);
      await hush(page);
    }),
  );

  // --- Act IV: across the whole library, and out to the graph ---
  segments.push(
    await browserAct(browser, async (page) => {
      await tapSelector(page, '#views button[data-view="notebook"]', 1000);
      await say(page, 'Every highlight in the library, across every book.', 3400);
      await say(page, 'Which is the one thing a per-book file browser cannot do.', 3600);
      await page.waitForTimeout(1200);

      const downloaded = page.waitForEvent('download', { timeout: 10000 });
      await say(page, 'And then out to Logseq, where the thinking happens.', 3400);
      await tapSelector(page, '#export', 1200);
      const download = await downloaded;
      const saved = path.join(OUT, 'pitch-highlights.md');
      await download.saveAs(saved);
      await card(
        page,
        `<pre>${readFileSync(saved, 'utf8')
          .split('\n')
          .slice(0, 16)
          .join('\n')
          .replace(/</g, '&lt;')}</pre>`,
      );
      await say(page, 'One outline per book, with the page you found it on.', 3600);
      await hush(page);
      await uncard(page);
    }),
  );

  // --- Act V: what it becomes ---
  segments.push(
    await browserAct(browser, async (page) => {
      await page.goto(`${BASE}/vision.html`);
      await page.waitForTimeout(1200);
      await installOverlay(page);
      await say(page, 'And this is where it goes, once the reading is somebody else’s job.', 4000);
      await say(page, 'A year of reading, counted honestly — including what you put down.', 4000);
      await tapSelector(page, '#views button[data-view="log"]', 1400);
      await page.waitForTimeout(2000);

      await tapSelector(page, '#views button[data-view="commonplace"]', 1400);
      await say(page, 'A commonplace book: something you marked, once, years ago.', 4000);
      await say(page, 'It never arrives on its own. It does not learn. There is no feed.', 4200);
      await tapSelector(page, '#cp-again', 1600);
      await page.waitForTimeout(1600);
      await hush(page);

      await card(
        page,
        '<h1>The hour is theirs.</h1><p>Everything on either side of it is ours.</p>',
      );
      await say(page, 'KOReader owns the hour you spend reading.', 3400);
      await say(page, 'reader-42 owns everything on either side of it.', 3800);
      await page.waitForTimeout(1200);
      await hush(page);
    }),
  );

  await browser.close();

  const out = path.join(OUT, 'reader-42-pitch.mp4');
  if (assemble(segments, WORK, out)) {
    console.log(`pitch: ${path.relative(process.cwd(), out)}`);
  } else {
    console.error('assembly failed');
    process.exit(1);
  }
}

await main();
