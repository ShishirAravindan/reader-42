// What a recording needs to drive a browser, and nothing else.
//
// This was the acceptance harness for the reader's scene suite — registration,
// assertions, throwaway libraries, phone and fresh-device contexts. The reader
// is gone and so is the suite; what survives is the two pieces every recording
// still needs. Kept as a module rather than inlined, for the reason its own
// header used to give: a second copy of the launch path is how one half rots
// unnoticed.

import { type Browser, chromium } from 'playwright';

/** Poll until a server answers, or give up and say so. */
export async function waitForServer(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server never came up at ${url}`);
}

/**
 * Launch chromium the one way everything here launches it: PW_CHROMIUM when
 * set, otherwise Playwright resolves its own install (`bunx playwright install
 * chromium`), which is what a cold clone has.
 */
export function launchChromium(headless: boolean): Promise<Browser> {
  return chromium.launch({
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    headless,
  });
}
