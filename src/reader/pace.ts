// Adaptive reading pace (parity B5): measure the reader's characters-per-
// second from position samples and answer "how many minutes for N chars".
//
// Constraints: pure and device-local — samples come in as character offsets
// (from metrics.ts) and wall-clock times; nothing here touches the DOM,
// storage, or layout. A sample only counts as reading when it looks like
// reading: 4s..90s between samples and forward motion. Backward jumps and
// long idles are navigation and coffee, not pace. The estimate is an EWMA
// weighted by sample duration, settling over ~5 minutes of active reading;
// before MIN_SAMPLED_SEC of evidence the model reports "still learning".

export interface PaceState {
  /** EWMA reading rate. */
  charsPerSec: number;
  /** Total seconds of counted reading evidence behind the estimate. */
  sampledSec: number;
}

export interface Pace {
  /** Feed the current position (global char offset) at a wall-clock time. */
  record(charOffset: number, atMs: number): void;
  state(): PaceState;
  /** True once enough reading has been observed to trust minutesFor(). */
  ready(): boolean;
  /** Minutes to read `chars` characters, or null while still learning. */
  minutesFor(chars: number): number | null;
}

/** Sample gates: shorter is a bounce, longer is an idle gap. */
export const MIN_SAMPLE_SEC = 4;
export const MAX_SAMPLE_SEC = 90;
/** Kindle's "Learning reading speed…" clears after this much evidence. */
export const MIN_SAMPLED_SEC = 120;
/** EWMA time constant: alpha = dt / (dt + this). */
const SETTLE_SEC = 300;

export function createPace(saved: PaceState | null): Pace {
  let charsPerSec = saved && isValidState(saved) ? saved.charsPerSec : 0;
  let sampledSec = saved && isValidState(saved) ? saved.sampledSec : 0;
  let prev: { offset: number; ms: number } | null = null;

  return {
    record(charOffset: number, atMs: number): void {
      const last = prev;
      prev = { offset: charOffset, ms: atMs };
      if (!last) return;
      const dt = (atMs - last.ms) / 1000;
      const delta = charOffset - last.offset;
      if (dt < MIN_SAMPLE_SEC || dt > MAX_SAMPLE_SEC || delta <= 0) return;
      const rate = delta / dt;
      const alpha = dt / (dt + SETTLE_SEC);
      charsPerSec =
        sampledSec > 0 && charsPerSec > 0 ? charsPerSec + alpha * (rate - charsPerSec) : rate;
      sampledSec += dt;
    },
    state: (): PaceState => ({ charsPerSec, sampledSec }),
    ready: (): boolean => sampledSec >= MIN_SAMPLED_SEC && charsPerSec > 0,
    minutesFor(chars: number): number | null {
      if (sampledSec < MIN_SAMPLED_SEC || charsPerSec <= 0) return null;
      return Math.max(chars, 0) / charsPerSec / 60;
    },
  };
}

function isValidState(state: PaceState): boolean {
  return (
    Number.isFinite(state.charsPerSec) &&
    state.charsPerSec >= 0 &&
    Number.isFinite(state.sampledSec) &&
    state.sampledSec >= 0
  );
}
