import { describe, expect, test } from 'bun:test';
import type { ReadingSession } from '../library/types.ts';
import { MAX_SAMPLE_SEC, type PaceState } from '../reader/pace.ts';
import { MIN_SESSION_SEC, trackReadingSession } from './session.ts';

const T0 = Date.parse('2026-07-20T10:00:00.000Z');

function harness(savedPace: PaceState | null = null) {
  let clock = T0;
  const sessions: ReadingSession[] = [];
  const paces: PaceState[] = [];
  const tracker = trackReadingSession({
    savedPace,
    savePace: (state) => paces.push(state),
    addSession: (session) => sessions.push(session),
    now: () => clock,
  });
  return {
    tracker,
    sessions,
    paces,
    /** An emission `sec` seconds into the session, at `chars` global offset. */
    record: (sec: number, chars: number): void => {
      clock = T0 + sec * 1000;
      tracker.record(chars, clock);
    },
    teardown: (sec: number): void => {
      clock = T0 + sec * 1000;
      tracker.teardown();
    },
  };
}

describe('trackReadingSession', () => {
  test('time between emissions accumulates into one session', () => {
    const h = harness();
    h.record(10, 1000);
    h.record(20, 2000);
    h.record(31, 3000);
    h.teardown(31);
    expect(h.sessions).toEqual([{ seconds: 31, endedAt: '2026-07-20T10:00:31.000Z' }]);
  });

  test('a stretch under the session floor is a peek, and is dropped', () => {
    const h = harness();
    h.record(10, 1000);
    h.record(MIN_SESSION_SEC - 1, 2000);
    h.teardown(MIN_SESSION_SEC - 1);
    expect(h.sessions).toEqual([]);
  });

  test('an idle gap does not count as reading', () => {
    const h = harness();
    h.record(10, 1000); // 10s of reading
    h.record(10 + MAX_SAMPLE_SEC + 100, 1100); // coffee: the gap is not reading
    h.record(10 + MAX_SAMPLE_SEC + 125, 2100); // 25s more
    h.teardown(10 + MAX_SAMPLE_SEC + 125);
    expect(h.sessions).toEqual([{ seconds: 35, endedAt: '2026-07-20T10:03:45.000Z' }]);
  });

  test('a flushed session does not flush twice', () => {
    const h = harness();
    h.record(40, 1000);
    h.teardown(40);
    h.teardown(200);
    expect(h.sessions).toHaveLength(1);
  });

  test('pace is persisted on every emission and answers once it has evidence', () => {
    const h = harness();
    expect(h.tracker.paceMinutesFor(6000)).toBeNull(); // still learning
    for (let i = 1; i <= 20; i++) h.record(i * 10, i * 1000); // 100 chars/sec
    expect(h.paces).toHaveLength(20);
    expect(h.paces[19]?.charsPerSec).toBeCloseTo(100, 6);
    expect(h.tracker.paceMinutesFor(6000)).toBeCloseTo(1, 6);
  });

  test('saved pace carries over, so a reopened book does not re-learn', () => {
    const h = harness({ charsPerSec: 50, sampledSec: 600 });
    expect(h.tracker.paceMinutesFor(3000)).toBeCloseTo(1, 6);
  });
});
