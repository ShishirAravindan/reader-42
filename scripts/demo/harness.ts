// Playwright acceptance harness for the page-model scenes: spawns the dev
// server against a throwaway library, drives real chromium, and provides
// scene registration plus assert/capture helpers. The scenes ARE the
// acceptance test (CLAUDE.md): jsdom cannot do layout, so everything
// geometry-dependent is proven here, in a real browser, before capture.
//
//   bun scripts/demo/run.ts [--video] [--headed]

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import type { LibraryTransport } from '../../src/library/transport.ts';

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
  /**
   * Run a body on a fresh device: its own storage, its own service worker, its
   * own network switch, closed when the body returns.
   *
   * The offline promises cannot be proven on the shared page. They need a
   * FIRST visit (a worker that has never installed), an empty device cache to
   * watch fill, and the network cut out from under them — none of which the
   * page the other scenes are reading on can offer without wrecking it.
   */
  onFreshDevice(body: (device: DeviceContext) => Promise<void>): Promise<void>;
}

export interface PhoneContext {
  page: Page;
  capture(label: string): Promise<void>;
}

export interface DeviceContext {
  page: Page;
  capture(label: string): Promise<void>;
  /** Cut this device's network, or give it back. */
  setOffline(offline: boolean): Promise<void>;
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

/**
 * The gate on the gate: an EMPTY registry must be a failure, never a pass.
 *
 * Scenes register by side effect (`import './scenes.ts'` in run.ts). Split
 * that file, or drop the import while refactoring, and the run loop iterates
 * nothing, prints "all 0 scenes passed", and exits 0 — a green CI job that
 * proves the suite ran, not that anything held. Every geometry-dependent
 * invariant in this reader is claimed only here, so a suite that can pass by
 * running nothing is worse than no suite at all.
 *
 * Separate from `runScenes` and pure on purpose, so it can be unit tested
 * without a browser or a dev server.
 */
export function assertScenesRegistered(count: number): void {
  if (count > 0) return;
  throw new Error(
    'no scenes registered: the acceptance suite would have passed by running nothing ' +
      '(is the side-effect import of the scene modules still in run.ts?)',
  );
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

// --- booting the app ------------------------------------------------------
//
// Exported because the acceptance suite is not the only thing that has to
// drive the real app: the showcase recording does too. It used to carry its
// own copies of all of this, including a chromium path that did not exist on
// any machine here, which is how a second, quietly broken way to start the app
// grew alongside the one CI exercises.

/** Poll until the dev server answers, or give up and say so. */
export async function waitForServer(url: string): Promise<void> {
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

/** Spawn the dev server over a library folder. Kill the handle when done. */
export function startDevServer(port: number, libDir: string): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(['bun', path.join(import.meta.dir, '..', 'dev.ts')], {
    env: { ...process.env, PORT: String(port), LIBRARY_DIR: libDir },
    stdout: 'ignore',
  });
}

/**
 * Launch chromium the one way everything here launches it: PW_CHROMIUM when
 * set, otherwise Playwright resolves its own install (`bunx playwright install
 * chromium`), which is what CI and a cold clone both have.
 */
export function launchChromium(headless: boolean): Promise<Browser> {
  return chromium.launch({
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    headless,
  });
}

/** A throwaway library folder under DEMO_TMP (or the system temp dir). */
export function makeLibraryDir(prefix: string): string {
  return mkdtempSync(path.join(process.env.DEMO_TMP ?? os.tmpdir(), prefix));
}

/**
 * Plain-filesystem transport, for scripts that seed a library BEFORE a browser
 * exists. The scenes themselves import through the UI instead, because an
 * import that only ever happens behind the app's back is an import path the
 * suite never checks.
 */
export class FsTransport implements LibraryTransport {
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

export async function runScenes(): Promise<void> {
  // Before anything is spawned or created: a guard that fires after the dev
  // server is up leaks the server and the temp library on the way out.
  assertScenesRegistered(scenes.length);
  const flags = new Set(process.argv.slice(2));
  const port = Number(process.env.PORT ?? 4299);
  const base = `http://localhost:${port}`;
  mkdirSync(OUT, { recursive: true });
  const libDir = makeLibraryDir('reader42-pages-');
  const server = startDevServer(port, libDir);

  let browser: Browser | null = null;
  let page: Page | null = null;
  let current = '';
  let shot = 0;

  try {
    await waitForServer(`${base}/`);
    const launched = await launchChromium(!flags.has('--headed'));
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
      onFreshDevice: async (body): Promise<void> => {
        const deviceContext = await launched.newContext({
          viewport: { width: 1280, height: 800 },
        });
        const devicePage = await deviceContext.newPage();
        try {
          await body({
            page: devicePage,
            capture: (label: string): Promise<void> => capture(devicePage, label),
            setOffline: (offline: boolean): Promise<void> => deviceContext.setOffline(offline),
          });
        } finally {
          // Give the network back before closing: a context torn down while
          // offline can leave the shared server holding a half-dead socket.
          await deviceContext.setOffline(false);
          await deviceContext.close();
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
