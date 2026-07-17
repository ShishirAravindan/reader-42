// PWA shell acceptance test + evidence capture.
//
// The demo script is the acceptance test (see .claude/CLAUDE.md): it drives
// the real app in a real browser and asserts the load-bearing behavior, and
// the screenshots are the byproduct. Here that behavior is:
//
//   1. the first online visit installs the service worker and precaches the shell
//   2. with the network cut, a fresh navigation still renders the app
//   3. the offline cold-open beats the product-law budget: under one second
//
// Run: bun scripts/demo/pwa-shell.ts
// Set PW_CHROMIUM to a chromium binary if playwright's own download is absent.
// Output lands in scripts/demo/out/.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 4243;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(import.meta.dir, 'out');

function assert(ok: boolean, label: string): void {
  if (!ok) throw new Error(`FAIL: ${label}`);
  console.log(`ok: ${label}`);
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

  // 1. First visit, online: the worker installs, claims, and precaches.
  await page.goto(`${BASE}/`);
  await page.waitForSelector('#welcome:not([hidden])');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((k) => k.startsWith('shell-'));
    if (names.length !== 1) return [];
    const cache = await caches.open(names[0] as string);
    return (await cache.keys()).map((req) => new URL(req.url).pathname).sort();
  });
  for (const p of ['/', '/app.js', '/styles.css', '/manifest.webmanifest']) {
    assert(cached.includes(p), `precached ${p}`);
  }

  // 2 + 3. Cut the network; a fresh navigation must still open, fast.
  await context.setOffline(true);
  const t0 = performance.now();
  await page.reload();
  await page.waitForSelector('#welcome:not([hidden])');
  const wall = performance.now() - t0;
  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return { interactive: entry.domContentLoadedEventEnd, loaded: entry.loadEventEnd };
  });
  await page.screenshot({ path: path.join(OUT, 'pwa-shell-offline.png') });
  assert(nav.interactive > 0, 'offline navigation produced real timings');
  assert(
    nav.interactive < 1000,
    `offline cold-open under 1s (shell interactive at ${nav.interactive.toFixed(0)}ms)`,
  );

  console.log('\noffline cold-open:');
  console.log(`  shell interactive (domContentLoaded): ${nav.interactive.toFixed(0)}ms`);
  console.log(`  fully loaded (loadEventEnd):          ${nav.loaded.toFixed(0)}ms`);
  console.log(`  wall clock incl. automation:          ${wall.toFixed(0)}ms`);
  console.log(`evidence: ${path.join(OUT, 'pwa-shell-offline.png')}`);

  await browser.close();
} finally {
  server.kill();
  rmSync(libDir, { recursive: true, force: true });
}
