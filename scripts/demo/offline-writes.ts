// Offline write queue acceptance test.
//
// Drives the real app through the milestone's riskiest promise: writes made
// while the transport is unreachable are never lost and never clobber
// another device's work.
//
//   1. reading online saves position to the library folder
//   2. with the network cut, turning pages still "saves" — the write queues
//      on the device and the folder provably does not change
//   3. while this device is offline, another device adds a highlight to the
//      same sidecar
//   4. the network returns; the queue flushes; the folder ends up with BOTH
//      this device's newer position AND the other device's highlight,
//      merged field-wise per the contract's clocks
//
// Run: bun scripts/demo/offline-writes.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Library } from '../../src/library/store.ts';
import type { LibraryTransport } from '../../src/library/transport.ts';
import { buildFixtureEpub } from '../../test/fixture-epub.ts';

const PORT = 4245;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(import.meta.dir, 'out');

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

async function until(label: string, check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`FAIL (timeout): ${label}`);
}

mkdirSync(OUT, { recursive: true });
const libDir = mkdtempSync(path.join(os.tmpdir(), 'reader42-demo-'));

const seedLibrary = await Library.open(new FsTransport(libDir));
const { sidecar } = await seedLibrary.importBook(buildFixtureEpub(), {
  title: 'The Fixture of Everything',
  author: 'A. Test Author',
});
const bookDir = JSON.parse(readFileSync(path.join(libDir, 'library.json'), 'utf8')).books.find(
  (b: { id: string }) => b.id === sidecar.id,
).dir;
const sidecarPath = path.join(libDir, bookDir, 'book.json');
const diskSidecar = () => JSON.parse(readFileSync(sidecarPath, 'utf8'));

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

  // 1. Online reading reaches the folder.
  await page.goto(`${BASE}/?lib=dev`);
  await page.getByText('The Fixture of Everything').click();
  await page.getByRole('heading', { name: 'One: A Beginning' }).waitFor();
  await page.getByRole('button', { name: 'Next ›' }).click();
  await page.getByRole('heading', { name: 'Two: The Long Middle' }).waitFor();
  await until('online page turn saved to the folder', () => diskSidecar().position?.chapter === 1);
  assert(true, 'online page turn saved position.chapter=1 to the folder');

  // 2. Network cut: another page turn queues instead of failing.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Next ›' }).click();
  await page.getByRole('heading', { name: 'Three: An End' }).waitFor();
  await new Promise((r) => setTimeout(r, 800)); // give a broken write every chance to land
  assert(
    diskSidecar().position.chapter === 1,
    'offline page turn did NOT reach the folder (queued on device)',
  );
  await page.screenshot({ path: path.join(OUT, 'offline-writes-reading-offline.png') });

  // 3. Another device highlights the same book meanwhile.
  const other = diskSidecar();
  other.highlights = [
    {
      id: 'hl-other-device',
      chapter: 0,
      start: { path: [1], offset: 0 },
      end: { path: [1], offset: 20 },
      text: 'The first chapter is short.',
      createdAt: new Date().toISOString(),
    },
  ];
  writeFileSync(sidecarPath, `${JSON.stringify(other, null, 2)}\n`);

  // 4. Reconnect: the queue flushes and merges, losing neither device's work.
  await context.setOffline(false);
  await until(
    'flush merged both devices field-wise',
    () =>
      diskSidecar().position?.chapter === 2 &&
      diskSidecar().highlights.some((h: { id: string }) => h.id === 'hl-other-device'),
  );
  assert(true, "flush kept this device's newer position (chapter 3 of 3)");
  assert(true, "flush kept the other device's highlight (union, nothing lost)");

  console.log('\nqueued offline, merged on reconnect: position latest-wins, highlights union');
  console.log(`evidence: ${OUT}/offline-writes-reading-offline.png`);

  await browser.close();
} finally {
  server.kill();
  rmSync(libDir, { recursive: true, force: true });
}
