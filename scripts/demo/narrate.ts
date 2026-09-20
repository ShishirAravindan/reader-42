// Narration for a recording: the caption strip, the tap marker, and the two
// ways a recording clicks something.
//
// Extracted so a second recording cannot grow its own copy. This file exists
// because showcase.ts once carried a private duplicate of the driving code and
// one half rotted unnoticed (see its header, and scripts/demo/README.md):
// nothing in CI runs a recording, so a stale copy stays green forever.
//
// A caption can also be SPOKEN (voice.ts). When narration is on, `say()`
// synthesizes the line first, holds the caption for at least as long as the
// speech, and records the offset against the recording's own clock — so the
// mix afterwards is placement, never editing. See startNarration().

import type { Page } from 'playwright';
import { type NarrationLine, speak, voiceAvailable } from './voice.ts';

const OVERLAY_CSS = `
  #showcase-caption {
    position: fixed;
    left: 50%;
    bottom: 3.2rem;
    transform: translateX(-50%) translateY(0.4rem);
    max-width: 46rem;
    z-index: 2147483647;
    pointer-events: none;
    background: rgba(18, 17, 15, 0.9);
    color: #f7f5ef;
    font: 500 1.05rem/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 0.7rem 1.1rem;
    border-radius: 10px;
    text-align: center;
    opacity: 0;
    transition: opacity 260ms ease, transform 260ms ease;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
  }
  #showcase-caption.on { opacity: 1; transform: translateX(-50%) translateY(0); }
  .showcase-tap {
    position: fixed;
    z-index: 2147483646;
    pointer-events: none;
    width: 44px;
    height: 44px;
    margin: -22px 0 0 -22px;
    border-radius: 50%;
    border: 2px solid rgba(51, 81, 138, 0.9);
    background: rgba(51, 81, 138, 0.22);
    animation: showcase-tap 620ms ease-out forwards;
  }
  @keyframes showcase-tap {
    0% { transform: scale(0.5); opacity: 0.95; }
    100% { transform: scale(1.5); opacity: 0; }
  }
`;

export async function installOverlay(page: Page): Promise<void> {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(() => {
    if (document.getElementById('showcase-caption')) return;
    const caption = document.createElement('div');
    caption.id = 'showcase-caption';
    document.body.appendChild(caption);
  });
}

// --- narration clock -------------------------------------------------------
//
// Offsets are measured from the moment the recording started, which is the
// moment the page was created. Everything else (the goto, the first waits) is
// already in the video, so anchoring here keeps speech and picture aligned
// without a calibration step.

let clockStart: number | null = null;
let lines: NarrationLine[] = [];
let voiceOn = false;

/** Start the clock, at the same moment the video does. `voice` off leaves the
 * recording exactly as it was: silent, same timings. */
export function startNarration(voice: boolean): void {
  clockStart = Date.now();
  lines = [];
  voiceOn = voice && voiceAvailable();
}

/** What was said, and when. Empty when narration was off. */
export function narration(): NarrationLine[] {
  return lines;
}

/** Breathing room after a line, so two captions never run together. */
const TAIL_MS = 320;

export async function say(page: Page, text: string, holdMs = 2600): Promise<void> {
  // Synthesize BEFORE the caption appears: the duration decides the hold, and
  // the clip has to exist before we can say when it started.
  const spokenLine = voiceOn ? speak(text) : null;
  const at = clockStart === null ? 0 : Date.now() - clockStart;

  await page.evaluate((t: string) => {
    const el = document.getElementById('showcase-caption');
    if (!el) return;
    el.textContent = t;
    el.classList.add('on');
  }, text);

  if (spokenLine) {
    lines.push({ text, atMs: at, file: spokenLine.file, ms: spokenLine.ms });
    // A written hold is a guess at reading speed; speech is a measurement.
    // Take whichever is longer so a line is never cut off mid-sentence.
    await page.waitForTimeout(Math.max(holdMs, spokenLine.ms + TAIL_MS));
    return;
  }
  await page.waitForTimeout(holdMs);
}

/**
 * A spoken line with nothing to caption.
 *
 * The reel cuts to real KOReader footage, where there is no page to inject a
 * caption strip into — and painting one over someone else's application would
 * be the wrong thing anyway. The voice carries those beats alone; the pictures
 * there (a page turning, a passage filling with colour) do not need a label.
 */
export async function sayOver(text: string, holdMs = 2600): Promise<void> {
  const spokenLine = voiceOn ? speak(text) : null;
  const at = clockStart === null ? 0 : Date.now() - clockStart;
  if (spokenLine) {
    lines.push({ text, atMs: at, file: spokenLine.file, ms: spokenLine.ms });
    await new Promise((r) => setTimeout(r, Math.max(holdMs, spokenLine.ms + TAIL_MS)));
    return;
  }
  await new Promise((r) => setTimeout(r, holdMs));
}

export async function hush(page: Page, ms = 350): Promise<void> {
  await page.evaluate(() => document.getElementById('showcase-caption')?.classList.remove('on'));
  await page.waitForTimeout(ms);
}

/** Draw the tap marker, so the recording shows where a tap landed. */
export async function mark(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]: number[]) => {
      const dot = document.createElement('div');
      dot.className = 'showcase-tap';
      dot.style.left = `${px}px`;
      dot.style.top = `${py}px`;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 700);
    },
    [x, y],
  );
  await page.waitForTimeout(180);
}

/** Click a raw point (the reading zones have no element of their own). */
export async function tap(page: Page, x: number, y: number, settleMs = 700): Promise<void> {
  await mark(page, x, y);
  await page.mouse.click(x, y);
  await page.waitForTimeout(settleMs);
}

/**
 * Tap a control. Waits for it to be actually clickable first and clicks through
 * the locator (Playwright's own actionability checks), with the marker drawn at
 * its box — a raw coordinate click can land while chrome is still animating.
 */
export async function tapSelector(page: Page, selector: string, settleMs = 700): Promise<void> {
  // .first(): a showcase taps "the next one of these", and several selectors
  // here (a search hit, a book on the shelf) legitimately match many.
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'visible', timeout: 8000 });
  const box = await target.boundingBox();
  if (box) await mark(page, box.x + box.width / 2, box.y + box.height / 2);
  await target.click();
  await page.waitForTimeout(settleMs);
}
