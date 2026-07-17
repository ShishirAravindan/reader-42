// Phone ergonomics acceptance test + evidence capture.
//
// Product law: the phone is a first-class reading surface. This drives the
// app in an emulated phone (390x844, touch, 3x) and asserts the ergonomics
// that make one-thumb reading real:
//
//   1. nothing overflows horizontally, on the shelf or in the reader
//   2. every control is a real fingertip target (44px minimum)
//   3. a touch tap turns the page (no double-tap-zoom hijack)
//
// Run: bun scripts/demo/phone-ergonomics.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Library } from '../../src/library/store.ts';
import type { LibraryTransport } from '../../src/library/transport.ts';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';

const PORT = 4246;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(import.meta.dir, 'out');
const TAP_TARGET = 44;

function assert(ok: boolean, label: string): void {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`ok: ${label}`);
}

class FsTransport implements LibraryTransport {
  constructor(private readonly root: string) {}
  async read(p: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(readFileSync(path.join(this.root, p)));
    } catch {
      return null;
    }
  }
  async write(p: string, bytes: Uint8Array): Promise<void> {
    const abs = path.join(this.root, p);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
  }
}

async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`dev server never came up at ${url}`);
}

mkdirSync(OUT, { recursive: true });
const libDir = mkdtempSync(path.join(os.tmpdir(), 'reader42-demo-'));
const seedLibrary = await Library.open(new FsTransport(libDir));
await seedLibrary.importBook(buildFixtureEpub(), {
  title: 'The Fixture of Everything',
  author: 'A. Test Author',
});

const server = Bun.spawn(['bun', path.join(import.meta.dir, '..', 'dev.ts')], {
  env: { ...process.env, PORT: String(PORT), LIBRARY_DIR: libDir },
  stdout: 'ignore',
});

try {
  await waitForServer(`${BASE}/`);
  const browser = await chromium.launch({
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  const noHorizontalOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const undersizedControls = () =>
    page.evaluate((min) => {
      const controls = [...document.querySelectorAll('button, .import-label')].filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0; // visible only
      });
      return controls
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.height < min || rect.width < min;
        })
        .map((node) => node.textContent?.trim() ?? node.tagName);
    }, TAP_TARGET);

  // 1. Shelf.
  await page.goto(`${BASE}/?lib=dev`);
  await page.locator('.book-title', { hasText: 'The Fixture of Everything' }).waitFor();
  assert(await noHorizontalOverflow(), 'shelf: no horizontal overflow at 390px');
  let undersized = await undersizedControls();
  assert(
    undersized.length === 0,
    `shelf: all controls >=44px (${undersized.join(', ') || 'none'} undersized)`,
  );
  await page.screenshot({ path: path.join(OUT, 'phone-shelf.png') });

  // 2. Reader, scroll mode.
  await page.getByText('The Fixture of Everything').tap();
  await page.getByRole('heading', { name: 'One: A Beginning' }).waitFor();
  assert(await noHorizontalOverflow(), 'reader: no horizontal overflow at 390px');
  undersized = await undersizedControls();
  assert(
    undersized.length === 0,
    `reader: all controls >=44px (${undersized.join(', ') || 'none'} undersized)`,
  );

  // 3. A real touch tap turns the page.
  await page.getByRole('button', { name: 'Next ›' }).tap();
  await page.getByRole('heading', { name: 'Two: The Long Middle' }).waitFor();
  assert(true, 'touch tap on Next turned the page');
  await page.screenshot({ path: path.join(OUT, 'phone-reader.png') });

  console.log(`\nevidence: ${OUT}/phone-{shelf,reader}.png`);
  await browser.close();
} finally {
  server.kill();
  rmSync(libDir, { recursive: true, force: true });
}
