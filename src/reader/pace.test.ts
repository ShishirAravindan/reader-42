import { describe, expect, test } from 'bun:test';
import { MAX_SAMPLE_SEC, MIN_SAMPLED_SEC, MIN_SAMPLE_SEC, createPace } from './pace.ts';

const sec = (s: number): number => s * 1000;

/** Feed steady reading: `rate` chars/sec in `stepSec` steps for `totalSec`. */
function readSteadily(
  pace: ReturnType<typeof createPace>,
  rate: number,
  totalSec: number,
  stepSec = 30,
  startOffset = 0,
  startMs = 0,
): { offset: number; ms: number } {
  let offset = startOffset;
  let ms = startMs;
  pace.record(offset, ms);
  for (let t = 0; t < totalSec; t += stepSec) {
    offset += rate * stepSec;
    ms += sec(stepSec);
    pace.record(offset, ms);
  }
  return { offset, ms };
}

describe('createPace', () => {
  test('starts unlearned: not ready, minutesFor null', () => {
    const pace = createPace(null);
    expect(pace.ready()).toBe(false);
    expect(pace.minutesFor(1000)).toBeNull();
    expect(pace.state()).toEqual({ charsPerSec: 0, sampledSec: 0 });
  });

  test('learns a steady rate and becomes ready after MIN_SAMPLED_SEC', () => {
    const pace = createPace(null);
    readSteadily(pace, 20, MIN_SAMPLED_SEC - 30);
    expect(pace.ready()).toBe(false);
    readSteadily(pace, 20, 60, 30, 10_000, sec(10_000));
    expect(pace.ready()).toBe(true);
    expect(pace.state().charsPerSec).toBeCloseTo(20, 5);
    // 20 chars/sec -> 1200 chars/min: 6000 chars is 5 minutes.
    expect(pace.minutesFor(6000)).toBeCloseTo(5, 5);
  });

  test('too-quick samples do not count (page flipping)', () => {
    const pace = createPace(null);
    pace.record(0, 0);
    pace.record(500, sec(MIN_SAMPLE_SEC - 1));
    expect(pace.state().sampledSec).toBe(0);
  });

  test('long idles do not count, and do not poison the next sample', () => {
    const pace = createPace(null);
    pace.record(0, 0);
    pace.record(100, sec(MAX_SAMPLE_SEC + 10)); // came back from coffee
    expect(pace.state().sampledSec).toBe(0);
    // The idle sample still re-baselined (offset, time): the next span counts.
    pace.record(700, sec(MAX_SAMPLE_SEC + 40));
    expect(pace.state().sampledSec).toBe(30);
    expect(pace.state().charsPerSec).toBeCloseTo(20, 5);
  });

  test('backward jumps are not reading', () => {
    const pace = createPace(null);
    pace.record(5000, 0);
    pace.record(1000, sec(30)); // jumped back to re-read
    expect(pace.state().sampledSec).toBe(0);
    pace.record(1600, sec(60)); // and read forward from there
    expect(pace.state().charsPerSec).toBeCloseTo(20, 5);
  });

  test('EWMA drifts toward a new rate without snapping to it', () => {
    const pace = createPace({ charsPerSec: 10, sampledSec: 600 });
    readSteadily(pace, 40, 120);
    const rate = pace.state().charsPerSec;
    expect(rate).toBeGreaterThan(10);
    expect(rate).toBeLessThan(40);
  });

  test('restores from saved state, ready immediately with enough evidence', () => {
    const pace = createPace({ charsPerSec: 15, sampledSec: 500 });
    expect(pace.ready()).toBe(true);
    expect(pace.minutesFor(900)).toBeCloseTo(1, 5);
  });

  test('garbage saved state degrades to unlearned, never throws', () => {
    for (const bad of [
      { charsPerSec: Number.NaN, sampledSec: 10 },
      { charsPerSec: -5, sampledSec: 10 },
      { charsPerSec: 10, sampledSec: Number.POSITIVE_INFINITY },
    ]) {
      const pace = createPace(bad);
      expect(pace.ready()).toBe(false);
      expect(pace.state()).toEqual({ charsPerSec: 0, sampledSec: 0 });
    }
  });

  test('minutesFor clamps negative char counts to zero', () => {
    const pace = createPace({ charsPerSec: 15, sampledSec: 500 });
    expect(pace.minutesFor(-100)).toBe(0);
  });
});
