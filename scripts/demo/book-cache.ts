// On-device book cache acceptance test + evidence capture.
//
// Asserts the load-bearing behavior of the offline milestone's second layer:
//
//   1. opening a book online lands its bytes in the device cache
//      (Cache API for the epub, IndexedDB for sidecar/index)
//   2. with the network cut, a cold navigation straight into the book
//      still renders the chapter — reads never require the network
//   3. that offline open-to-reading beats the product-law budget: under 1s
//   4. the shelf also works offline, from the cached index and sidecars
//
// Run: bun scripts/demo/book-cache.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Library } from '../../src/library/store.ts';
import type { LibraryTransport } from '../../src/library/transport.ts';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';

const PORT = 4244;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(import.meta.dir, 'out');

function assert(ok: boolean, label: string): void {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`ok: ${label}`);
}

/** Seeding transport over the dev library folder. */
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

// Seed: one fixture book, on deck.
const seedLibrary = await Library.open(new FsTransport(libDir));
const { sidecar } = await seedLibrary.importBook(buildFixtureEpub(), {
  title: 'The Fixture of Everything',
  author: 'A. Test Author',
});
const indexPath = path.join(libDir, 'library.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
index.onDeck = [sidecar.id];
writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

const server = Bun.spawn(['bun', path.join(import.meta.dir, '..', 'dev.ts')], {
  env: { ...process.env, PORT: String(PORT), LIBRARY_DIR: libDir },
  stdout: 'ignore',
});

try {
  await waitForServer(`${BASE}/`);
  const browser = await chromium.launch({
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. Online: shelf, open the book, let the cache fill.
  await page.goto(`${BASE}/?lib=dev`);
  await page.getByText('The Fixture of Everything').click();
  await page.getByRole('heading', { name: 'One: A Beginning' }).waitFor();
  await page.waitForFunction(async () => {
    const cache = await caches.open('books-v1');
    return (await cache.keys()).length >= 1;
  });
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('reader-42', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onsuccess = () => {
          const get = req.result.transaction('files').objectStore('files').getAllKeys();
          get.onsuccess = () => resolve(get.result.length >= 3); // index, sidecar, ~pinned
          get.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      }),
  );
  assert(true, 'online open cached epub (Cache API) and sidecars (IndexedDB)');

  // 2 + 3. Network cut, cold navigation straight into the book.
  await context.setOffline(true);
  const t0 = performance.now();
  await page.reload();
  await page.getByRole('heading', { name: 'One: A Beginning' }).waitFor();
  const openToReading = performance.now() - t0;
  await page.screenshot({ path: path.join(OUT, 'book-cache-offline-reading.png') });
  assert(true, 'offline cold navigation rendered the chapter from the device cache');
  assert(
    openToReading < 1000,
    `offline open-to-reading under 1s (${openToReading.toFixed(0)}ms wall clock)`,
  );

  // 4. The shelf works offline too, from cached index + sidecars.
  await page.getByText('‹ Library').click();
  await page.locator('.book-title', { hasText: 'The Fixture of Everything' }).waitFor();
  await page.screenshot({ path: path.join(OUT, 'book-cache-offline-shelf.png') });
  assert(true, 'offline shelf rendered from the cached index');

  console.log(
    `\noffline open-to-reading: ${openToReading.toFixed(0)}ms (product-law budget: 1000ms)`,
  );
  console.log(`evidence: ${OUT}/book-cache-offline-{reading,shelf}.png`);

  await browser.close();
} finally {
  server.kill();
  rmSync(libDir, { recursive: true, force: true });
}
