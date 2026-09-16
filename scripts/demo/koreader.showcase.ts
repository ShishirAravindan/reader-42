// The KOReader spike, recorded.
//
//   bun scripts/demo/koreader.showcase.ts --book <x.epub> --sidecar <metadata.epub.lua>
//
// What it shows, in order: a sidecar a device wrote, the shelf reading that
// device's progress, the device's highlights rendered in reader-42's own text,
// and the Logseq outline coming out the far side — with the one annotation that
// did not cross named on screen rather than quietly dropped.
//
// It asserts nothing. The assertions live in the acceptance suite
// (scenes.ts, the `koreader seam` scene); this is the thing you watch.
// Recording lives in scripts/demo/out/ and is gitignored.

import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import type { Page } from 'playwright';
import { sortHighlights } from '../../src/app/notebook.ts';
import { Book } from '../../src/epub/book.ts';
import { ingestSidecar } from '../../src/koreader/ingest.ts';
import { Library } from '../../src/library/store.ts';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';
import {
  FsTransport,
  launchChromium,
  makeLibraryDir,
  startDevServer,
  waitForServer,
} from './harness.ts';
import { hush, installOverlay, narration, say, startNarration, tapSelector } from './narrate.ts';
import { mixNarration } from './voice.ts';

(globalThis as { DOMParser?: unknown }).DOMParser ??= new JSDOM().window.DOMParser;

const OUT = path.join(import.meta.dir, 'out');
const VIDEO = { width: 1280, height: 800 };
const PORT = Number(process.env.PORT ?? 4302);
const BASE = `http://localhost:${PORT}`;

const args = process.argv.slice(2);
const argOf = (name: string): string | undefined =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined;

const sidecarPath =
  argOf('sidecar') ??
  path.join(import.meta.dir, '..', '..', 'test', 'fixture-koreader-sidecar.lua');
const bookArg = argOf('book');

// --- run the seam, then seed a library from what crossed ---

const bytes = bookArg ? new Uint8Array(readFileSync(bookArg)) : buildFixtureEpub();
const book = await Book.open(bytes);
const sidecarSource = readFileSync(sidecarPath, 'utf8');
const report = ingestSidecar(book, sidecarSource);

console.log(`koreader showcase: ${report.title} — ${report.resolved}/${report.total} crossed`);

mkdirSync(OUT, { recursive: true });
// Stale takes from an earlier run would otherwise sit next to this one and
// make "the newest webm" a coin toss.
for (const old of new Bun.Glob('*.webm').scanSync(OUT))
  rmSync(path.join(OUT, old), { force: true });
const libDir = makeLibraryDir('reader42-koreader-');
const library = await Library.open(new FsTransport(libDir));
const { sidecar } = await library.importBook(bytes, {
  title: report.title,
  author: report.author,
});
await library.saveSidecar({
  ...sidecar,
  state: 'reading',
  progress: report.progress ?? 0,
  highlights: sortHighlights(report.highlights),
});

/** The raw sidecar, shown on screen: the point is that this is a foreign file. */
const SOURCE_CSS = `
  #ko-source {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    display: grid;
    place-items: center;
    background: rgba(18, 17, 15, 0.94);
    opacity: 0;
    transition: opacity 320ms ease;
  }
  #ko-source.on { opacity: 1; }
  /* Faded out is not gone: an invisible full-screen div still swallows every
     click after it. Removal happens too, but this is the belt. */
  #ko-source:not(.on) { pointer-events: none; }
  #ko-source pre {
    max-width: 62rem;
    max-height: 70vh;
    overflow: hidden;
    margin: 0;
    color: #e9e5da;
    font: 400 0.85rem/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre;
  }
  #ko-source .ko-mark { color: #f0c05a; }
  #ko-source h4 {
    margin: 0 0 1rem;
    color: #a8a294;
    font: 500 0.95rem/1 -apple-system, system-ui, sans-serif;
    letter-spacing: 0.02em;
  }
`;

async function showSource(page: Page, snippet: string, heading: string): Promise<void> {
  await page.addStyleTag({ content: SOURCE_CSS });
  await page.evaluate(
    ([text, title]: string[]) => {
      let host = document.getElementById('ko-source');
      if (!host) {
        host = document.createElement('div');
        host.id = 'ko-source';
        host.innerHTML = '<div><h4></h4><pre></pre></div>';
        document.body.appendChild(host);
      }
      (host.querySelector('h4') as HTMLElement).textContent = title as string;
      const pre = host.querySelector('pre') as HTMLElement;
      pre.textContent = '';
      // Highlight the two fields that actually cross, so the eye knows where
      // to look: the text, and the xpointer that turns out not to travel.
      for (const line of (text as string).split('\n')) {
        const span = document.createElement('span');
        span.textContent = `${line}\n`;
        if (/\["(text|pos0)"\]/.test(line)) span.className = 'ko-mark';
        pre.appendChild(span);
      }
      host.classList.add('on');
    },
    [snippet, heading],
  );
  await page.waitForTimeout(400);
}

async function hideSource(page: Page): Promise<void> {
  await page.evaluate(() => document.getElementById('ko-source')?.classList.remove('on'));
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('ko-source')?.remove());
}

/** The first annotation block, which is the shape of the whole file. */
function firstAnnotation(source: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.includes('["annotations"]'));
  return lines.slice(start, start + 16).join('\n');
}

/** A still at each beat. The video is what a human watches; the frames are
 * what can be checked, and what CI would keep if this were ever gated. */
let shot = 0;
const frame = async (page: Page, label: string): Promise<void> => {
  shot += 1;
  await page.screenshot({
    path: path.join(OUT, `ko-${String(shot).padStart(2, '0')}-${label}.png`),
  });
};

const server = startDevServer(PORT, libDir);

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

  // 1. The foreign file.
  await page.goto(`${BASE}/?lib=dev`);
  await page.locator('.book-title').first().waitFor();
  await installOverlay(page);
  await showSource(page, firstAnnotation(sidecarSource), path.basename(sidecarPath));
  await say(page, 'This file was written by KOReader, on a device, in Lua.', 3200);
  await say(page, 'Two fields matter. The text — and the xpointer, which addresses', 3000);
  await say(page, "crengine's DOM, not a browser's. Only one of them travels.", 3200);
  await frame(page, 'sidecar-source');
  await hush(page);
  await hideSource(page);

  // 2. The shelf reads it.
  await say(page, 'reader-42 has never opened this book. The shelf still knows it.', 3400);
  await say(
    page,
    `Progress, ${((report.progress ?? 0) * 100).toFixed(0)}%, came from the device.`,
    3000,
  );
  await hush(page);

  // 3. The device's highlights, in our text.
  await frame(page, 'shelf-progress');
  await tapSelector(page, '#book-list li', 1600);
  await installOverlay(page); // the reader section replaced the shelf
  await say(page, 'Open it, and the highlights made on the device are here.', 3000);
  await hush(page);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await tapSelector(page, '#notebook-toggle', 900);
  await page.locator('#notebook').waitFor({ state: 'visible', timeout: 8000 });
  await say(
    page,
    `${report.resolved} of ${report.total} crossed — text, colour, note and chapter.`,
    3400,
  );
  await say(page, 'Located by matching the text, since the xpointer could not be used.', 3400);
  await hush(page);
  await frame(page, 'notebook');

  // 4. A highlight is a real highlight: it renders where it belongs.
  await tapSelector(page, '#notebook .nb-text', 1600);
  await say(page, 'Tapping one jumps to it — a real locator, drawn in the page.', 3400);
  await hush(page);
  await frame(page, 'highlight-in-page');

  // 5. Out to Logseq.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await tapSelector(page, '#notebook-toggle', 900);
  await page.locator('#notebook').waitFor({ state: 'visible', timeout: 8000 });
  await say(page, 'And out to Logseq, through reader-42’s own exporter.', 3000);
  // Take the file the app actually produced, rather than re-deriving it here:
  // a recording that shows its own output proves nothing about the app.
  const downloaded = page.waitForEvent('download', { timeout: 10000 });
  await tapSelector(page, '#notebook-export', 1000);
  const download = await downloaded;
  const savedTo = path.join(OUT, 'koreader-highlights.md');
  await download.saveAs(savedTo);
  await hush(page);
  await showSource(page, readFileSync(savedTo, 'utf8'), download.suggestedFilename());
  await say(page, 'Text, chapter, note and a deep link — one outline per book.', 3400);
  await frame(page, 'export');
  await hush(page);
  await hideSource(page);

  // 6. The honest part.
  if (report.misses.length > 0) {
    await say(page, `${report.misses.length} did not cross, and is named, not dropped:`, 3000);
    await say(page, `“${report.misses[0]?.text.slice(0, 60)}…” — not found in this EPUB.`, 3600);
  }
  await say(page, 'What does not cross: the reading position. An xpointer is not a locator.', 4000);
  await hush(page);

  await context.close(); // flushes the video
  await browser.close();

  // Playwright names videos by a random id; give it the name a human wants.
  const videos = [...new Bun.Glob('*.webm').scanSync(OUT)].map((f) => path.join(OUT, f));
  const newest = videos.sort((a, b) => Bun.file(b).lastModified - Bun.file(a).lastModified)[0];
  if (newest) {
    const target = path.join(OUT, 'koreader-seam.webm');
    if (newest !== target) {
      rmSync(target, { force: true });
      renameSync(newest, target);
    }
    const spoken = path.join(OUT, 'koreader-seam.mp4');
    if (mixNarration(target, narration(), spoken)) {
      console.log(`recording: ${path.relative(process.cwd(), spoken)} (narrated)`);
    } else {
      console.log(`recording: ${path.relative(process.cwd(), target)}`);
    }
  }
} finally {
  server.kill();
  rmSync(libDir, { recursive: true, force: true });
}
