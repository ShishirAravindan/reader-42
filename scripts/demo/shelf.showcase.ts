// reader-42 with no reader, recorded.
//
//   bun scripts/demo/shelf.showcase.ts --library <koreader folder>
//
// The inverted spike (docs/koreader-poc.md). The other recording shows a
// device's highlights arriving in reader-42's reader, which quietly makes
// KOReader a data source. This one shows the arrangement the other way round:
// KOReader's folder is the library, KOReader does the reading, and what is
// left here is a shelf, a cross-book notebook, and the off-ramp to Logseq.
//
// The moment that carries it is the handoff — the shelf knowing a book and
// then declining to open it.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { launchChromium, waitForServer } from './harness.ts';
import { hush, installOverlay, narration, say, startNarration, tapSelector } from './narrate.ts';
import { mixNarration } from './voice.ts';

const OUT = path.join(import.meta.dir, 'out');
const VIDEO = { width: 1280, height: 800 };
const PORT = Number(process.env.PORT ?? 4311);
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const libraryDir = args.includes('--library') ? args[args.indexOf('--library') + 1] : undefined;
if (!libraryDir) {
  console.error('usage: bun scripts/demo/shelf.showcase.ts --library <koreader folder>');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
for (const old of new Bun.Glob('shelf-*.{webm,png}').scanSync(OUT)) {
  rmSync(path.join(OUT, old), { force: true });
}

/** The folder, as a shell listing: the argument is that this is all there is. */
function folderListing(dir: string): string {
  const lines: string[] = [`$ ls "${path.basename(dir)}/"`, ''];
  for (const entry of readdirSync(dir).sort()) {
    lines.push(entry.endsWith('.sdr') ? `${entry}/  → metadata.epub.lua` : entry);
  }
  lines.push('', '# no library.json. no book.json. no import.');
  return lines.join('\n');
}

const CARD_CSS = `
  #card {
    position: fixed; inset: 0; z-index: 2147483646;
    display: grid; place-items: center;
    background: rgba(18, 17, 15, 0.94);
    opacity: 0; transition: opacity 320ms ease;
  }
  #card.on { opacity: 1; }
  #card:not(.on) { pointer-events: none; }
  #card pre {
    max-width: 62rem; max-height: 70vh; overflow: hidden; margin: 0;
    color: #e9e5da;
    font: 400 0.9rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre;
  }
  #card .dim { color: #8b8578; }
`;

async function showCard(page: Page, text: string): Promise<void> {
  await page.addStyleTag({ content: CARD_CSS });
  await page.evaluate((body: string) => {
    let host = document.getElementById('card');
    if (!host) {
      host = document.createElement('div');
      host.id = 'card';
      host.innerHTML = '<pre></pre>';
      document.body.appendChild(host);
    }
    const pre = host.querySelector('pre') as HTMLElement;
    pre.replaceChildren();
    for (const line of body.split('\n')) {
      const span = document.createElement('span');
      span.textContent = `${line}\n`;
      if (line.startsWith('#') || line.startsWith('$')) span.className = 'dim';
      pre.appendChild(span);
    }
    host.classList.add('on');
  }, text);
  await page.waitForTimeout(400);
}

async function hideCard(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('card')?.classList.remove('on'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('card')?.remove());
}

const server = Bun.spawn(['bun', path.join(import.meta.dir, '..', 'shelf-dev.ts')], {
  env: { ...process.env, PORT: String(PORT), LIBRARY_DIR: libraryDir },
  stdout: 'ignore',
});

let shot = 0;
const frame = async (page: Page, label: string): Promise<void> => {
  shot += 1;
  await page.screenshot({
    path: path.join(OUT, `shelf-${String(shot).padStart(2, '0')}-${label}.png`),
  });
};

try {
  await waitForServer(`${BASE}/`);
  const browser = await launchChromium(!args.includes('--headed'));
  const context = await browser.newContext({
    viewport: VIDEO,
    recordVideo: { dir: OUT, size: VIDEO },
  });
  const page = await context.newPage();
  // Same moment the video starts. --silent keeps the old, wordless recording.
  startNarration(!args.includes('--silent'));
  await page.goto(BASE);
  await page.locator('#shelf-list li').first().waitFor({ timeout: 20000 });
  await installOverlay(page);

  // 1. The folder is the library.
  await showCard(page, folderListing(libraryDir));
  await say(page, 'This is the library: a folder KOReader owns.', 3000);
  await say(page, 'EPUBs, and the sidecars the device writes beside them.', 3200);
  await say(page, 'reader-42 has no index, no import step, and no format of its own.', 3600);
  await frame(page, 'the-folder');
  await hush(page);
  await hideCard(page);

  // 2. The shelf, which is now the product.
  await say(page, 'It reads that folder, and what it makes of it is a shelf.', 3200);
  await say(page, 'Covers out of the EPUBs. Progress and state from the device.', 3400);
  await frame(page, 'shelf');
  await say(page, 'Four states, honestly — including the one shelves refuse to show.', 3400);
  await page.locator('#shelf-list li .state.dnf').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await frame(page, 'states');
  await hush(page);

  // 3. The handoff: the moment this app declines to be a reader.
  await say(page, 'Open one, and here is the whole posture in one dialog.', 3000);
  await tapSelector(page, '#ondeck-list li', 900);
  await page.locator('#handoff').waitFor({ state: 'visible', timeout: 5000 });
  await say(page, 'reader-42 does not open books. KOReader does.', 3600);
  await frame(page, 'handoff');
  await hush(page);
  await tapSelector(page, '#handoff-close', 600);

  // 4. The thing a file browser structurally cannot do.
  await tapSelector(page, '#views button[data-view="notebook"]', 900);
  await say(page, 'And this is what the folder cannot show you itself:', 3000);
  await say(page, 'every highlight in the library, across every book.', 3200);
  await frame(page, 'notebook');

  await say(page, 'Where did I read about…', 2200);
  await page.locator('#search').fill('night');
  await page.waitForTimeout(900);
  await frame(page, 'search');
  await say(page, 'One question, answered across a whole shelf at once.', 3200);
  await page.locator('#search').fill('');
  await page.waitForTimeout(500);
  await hush(page);

  // 5. Out to the graph.
  await say(page, 'Then out to Logseq, which is where the thinking happens.', 3200);
  const downloaded = page.waitForEvent('download', { timeout: 10000 });
  await tapSelector(page, '#export', 1000);
  const download = await downloaded;
  const savedTo = path.join(OUT, 'library-highlights.md');
  await download.saveAs(savedTo);
  await hush(page);
  await showCard(page, readFileSync(savedTo, 'utf8').split('\n').slice(0, 26).join('\n'));
  await say(page, 'One outline per book, chapter titles from the device.', 3400);
  await frame(page, 'export');
  await hush(page);
  await hideCard(page);

  // 6. The point.
  await say(page, 'There is no reader in this build. There is no code path to one.', 4000);
  await say(page, 'If the reading is solved elsewhere, this is what is left —', 3200);
  await say(page, 'and what is left is a product, not a consolation.', 3600);
  await frame(page, 'closing');
  await hush(page);

  await context.close();
  await browser.close();

  const videos = [...new Bun.Glob('*.webm').scanSync(OUT)]
    .map((f) => path.join(OUT, f))
    .filter((f) => !f.endsWith('koreader-seam.webm'));
  const newest = videos.sort((a, b) => Bun.file(b).lastModified - Bun.file(a).lastModified)[0];
  if (newest) {
    const target = path.join(OUT, 'shelf-no-reader.webm');
    if (newest !== target) {
      rmSync(target, { force: true });
      renameSync(newest, target);
    }
    const spoken = path.join(OUT, 'shelf-no-reader.mp4');
    if (mixNarration(target, narration(), spoken)) {
      console.log(`recording: ${path.relative(process.cwd(), spoken)} (narrated)`);
    } else {
      console.log(`recording: ${path.relative(process.cwd(), target)}`);
    }
  }
} finally {
  server.kill();
}
