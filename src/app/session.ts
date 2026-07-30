// Reading sessions and pace: the clock behind "12 min left" and the session
// rows in the sidecar (parity B5, salvage §5).
//
// Both ride the SAME activity clock, which is why they live together: the time
// between position emissions counts as reading unless the gap is long enough
// to be an idle, so a book left open on a table inflates neither number.
// Hidden time never counts at all — visibility changes flush and stop the
// clock. Pace is device-local taste-like telemetry (persisted through the
// injected callbacks); sessions are place-like and go into the synced sidecar
// through the shell's own save path, never a second storage route.

import type { ReadingSession } from '../library/types.ts';
import { MAX_SAMPLE_SEC, type PaceState, createPace } from '../reader/pace.ts';

/** A stretch under this long is a peek, not a reading session (salvage §5). */
export const MIN_SESSION_SEC = 30;

export interface ReadingSessionDeps {
  /** Pace learned for this book on this device, if any. */
  savedPace: PaceState | null;
  /** Persist pace after every sample; device-local, per book. */
  savePace(state: PaceState): void;
  /** Append a qualifying session to the sidecar (the shell owns the write). */
  addSession(session: ReadingSession): void;
  /** Wall clock in ms; injected so the accumulation is testable. */
  now?(): number;
}

export interface ReadingSessionTracker {
  /** A position emission: counts activity and samples pace. */
  record(globalChar: number, nowMs: number): void;
  /** Flush any qualifying session and detach listeners. */
  teardown(): void;
  paceMinutesFor(chars: number): number | null;
}

export function trackReadingSession(deps: ReadingSessionDeps): ReadingSessionTracker {
  const now = deps.now ?? Date.now;
  const pace = createPace(deps.savedPace);
  let sessionSec = 0;
  let lastActiveMs: number | null = now();

  const tickActivity = (nowMs: number): void => {
    if (lastActiveMs !== null) {
      const dt = (nowMs - lastActiveMs) / 1000;
      if (dt > 0 && dt <= MAX_SAMPLE_SEC) sessionSec += dt;
    }
    lastActiveMs = nowMs;
  };

  const flushSession = (): void => {
    if (sessionSec >= MIN_SESSION_SEC) {
      deps.addSession({
        seconds: Math.round(sessionSec),
        endedAt: new Date(now()).toISOString(),
      });
    }
    sessionSec = 0;
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      tickActivity(now());
      flushSession();
      lastActiveMs = null; // hidden time never counts
    } else {
      lastActiveMs = now();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    record(globalChar: number, nowMs: number): void {
      tickActivity(nowMs);
      pace.record(globalChar, nowMs);
      deps.savePace(pace.state());
    },
    teardown(): void {
      document.removeEventListener('visibilitychange', onVisibility);
      tickActivity(now());
      flushSession();
    },
    paceMinutesFor: (chars: number): number | null => pace.minutesFor(chars),
  };
}
