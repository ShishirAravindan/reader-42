// Playwright acceptance harness for the page-model scenes: spawns the dev
// server against a throwaway library, drives real chromium, and provides
// scene registration plus assert/capture helpers. The scenes ARE the
// acceptance test (CLAUDE.md): jsdom cannot do layout, so everything
// geometry-dependent is proven here, in a real browser, before capture.
//
//   bun scripts/demo/run.ts [--video] [--headed]

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';

export interface SceneContext {
  page: Page;
  base: string;
  /** Screenshot into scripts/demo/out/NN-label.png (gitignored evidence). */
  capture(label: string): Promise<void>;
  /**
   * Run a body against a fresh emulated phone (product law 5: the phone is a
   * reading surface, not a port). Its own context, so touch, scale, and the
   * device's own storage are real; closed when the body returns.
   */
  onPhone(body: (phone: PhoneContext) => Promise<void>): Promise<void>;
}

export interface PhoneContext {
  page: Page;
  capture(label: string): Promise<void>;
}

/** A mid-size modern phone: the screen the boredom moment actually happens on. */
const PHONE = { width: 390, height: 844 };

interface Scene {
  name: string;
  fn(ctx: SceneContext): Promise<void>;
}

const scenes: Scene[] = [];

/** Register a scene; scenes run sequentially in registration order. */
export function scene(name: string, fn: (ctx: SceneContext) => Promise<void>): void {
  scenes.push({ name, fn });
}

export function expect(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(`assert failed: ${label}`);
  console.log(`  ok: ${label}`);
}

export function expectEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `assert failed: ${label}\n    actual:   ${JSON.stringify(actual)}\n    expected: ${JSON.stringify(expected)}`,
    );
  }
  console.log(`  ok: ${label}`);
}

const OUT = path.join(import.meta.dir, 'out');

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

export async function runScenes(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const port = Number(process.env.PORT ?? 4299);
  const base = `http://localhost:${port}`;
  mkdirSync(OUT, { recursive: true });
  const libDir = mkdtempSync(path.join(process.env.DEMO_TMP ?? os.tmpdir(), 'reader42-pages-'));

  const server = Bun.spawn(['bun', path.join(import.meta.dir, '..', 'dev.ts')], {
    env: { ...process.env, PORT: String(port), LIBRARY_DIR: libDir },
    stdout: 'ignore',
  });

  let browser: Browser | null = null;
  let page: Page | null = null;
  let current = '';
  let shot = 0;

  try {
    await waitForServer(`${base}/`);
    const launched = await chromium.launch({
      executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium',
      headless: !flags.has('--headed'),
    });
    browser = launched;
    const context = await launched.newContext({
      viewport: { width: 1280, height: 800 },
      ...(flags.has('--video')
        ? { recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } }
        : {}),
    });
    page = await context.newPage();
    const activePage = page;

    const capture = async (target: Page, label: string): Promise<void> => {
      shot += 1;
      const file = path.join(OUT, `${String(shot).padStart(2, '0')}-${label}.png`);
      await target.screenshot({ path: file });
      console.log(`  shot: ${path.relative(process.cwd(), file)}`);
    };

    const ctx: SceneContext = {
      page: activePage,
      base,
      capture: (label: string): Promise<void> => capture(activePage, label),
      onPhone: async (body): Promise<void> => {
        const phoneContext = await launched.newContext({
          viewport: PHONE,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
        const phonePage = await phoneContext.newPage();
        try {
          await body({
            page: phonePage,
            capture: (label: string): Promise<void> => capture(phonePage, label),
          });
        } finally {
          await phoneContext.close();
        }
      },
    };

    for (const s of scenes) {
      current = s.name;
      console.log(`scene: ${s.name}`);
      await s.fn(ctx);
    }
    console.log(`\nall ${scenes.length} scenes passed; evidence in ${OUT}`);
    await context.close(); // flushes any recorded video
  } catch (err) {
    process.exitCode = 1;
    console.error(`\nFAIL in scene "${current}":`, err);
    try {
      await page?.screenshot({ path: path.join(OUT, `FAIL-${current || 'boot'}.png`) });
      console.error(`failure screenshot: ${path.join(OUT, `FAIL-${current || 'boot'}.png`)}`);
    } catch {
      // The page may already be gone; the error above is the signal.
    }
  } finally {
    await browser?.close();
    server.kill();
    rmSync(libDir, { recursive: true, force: true });
  }
}
