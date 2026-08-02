import { describe, expect, test } from 'bun:test';
import type { ReadingPosition } from '../library/types.ts';
import {
  BACK_STACK_CAP,
  PILL_HIDES_AFTER_TURNS,
  createJumpBack,
  jumpBackLabel,
  samePlace,
} from './jumpback.ts';

const at = (chapter: number): ReadingPosition => ({
  chapter,
  updatedAt: '2026-07-12T10:00:00.000Z',
});

const entry = (chapter: number, location: number) => ({ position: at(chapter), location });

describe('createJumpBack', () => {
  test('nothing to go back to before the first jump', () => {
    const stack = createJumpBack();
    expect(stack.state()).toEqual({ visible: false, entry: null });
    expect(stack.pop()).toBeNull();
  });

  test('a jump shows the pill, naming where you came FROM', () => {
    const stack = createJumpBack();
    stack.push(entry(2, 412));
    const state = stack.state();
    expect(state.visible).toBe(true);
    expect(jumpBackLabel(state.entry as never)).toBe('Back to Loc 412');
  });

  test('going back restores the previous jump, then the one before it', () => {
    const stack = createJumpBack();
    stack.push(entry(1, 100));
    stack.push(entry(2, 200));
    expect(stack.pop()?.location).toBe(200);
    expect(stack.state().visible).toBe(true);
    expect(stack.state().entry?.location).toBe(100);
    expect(stack.pop()?.location).toBe(100);
    expect(stack.state()).toEqual({ visible: false, entry: null });
  });

  test('three page turns settle the pill away, but never the stack', () => {
    const stack = createJumpBack();
    stack.push(entry(3, 300));
    for (let i = 1; i < PILL_HIDES_AFTER_TURNS; i++) {
      stack.turn();
      expect(stack.state().visible).toBe(true);
    }
    stack.turn();
    expect(stack.state().visible).toBe(false);
    // The way back survives; only the offer of it went quiet.
    expect(stack.pop()?.location).toBe(300);
  });

  test('a new jump brings the pill back and restarts the count', () => {
    const stack = createJumpBack();
    stack.push(entry(1, 100));
    for (let i = 0; i < PILL_HIDES_AFTER_TURNS; i++) stack.turn();
    expect(stack.state().visible).toBe(false);
    stack.push(entry(2, 200));
    expect(stack.state().visible).toBe(true);
    stack.turn();
    expect(stack.state().visible).toBe(true);
  });

  test('turns before any jump are simply reading', () => {
    const stack = createJumpBack();
    for (let i = 0; i < 10; i++) stack.turn();
    stack.push(entry(1, 100));
    expect(stack.state().visible).toBe(true);
  });

  test('the stack is capped; the oldest way back is dropped, never the newest', () => {
    const stack = createJumpBack();
    for (let i = 1; i <= BACK_STACK_CAP + 3; i++) stack.push(entry(i, i * 10));
    const seen: number[] = [];
    for (;;) {
      const popped = stack.pop();
      if (!popped) break;
      seen.push(popped.location);
    }
    expect(seen).toHaveLength(BACK_STACK_CAP);
    expect(seen[0]).toBe((BACK_STACK_CAP + 3) * 10);
    expect(seen[seen.length - 1]).toBe(40);
  });
});

describe('jumpBackLabel', () => {
  test('groups thousands, like the status line', () => {
    expect(jumpBackLabel(entry(9, 12345))).toBe('Back to Loc 12,345');
  });
});

describe('samePlace', () => {
  const at = (chapter: number, path: number[], ratio: number): ReadingPosition => ({
    chapter,
    anchor: { path, ratio },
    updatedAt: '2026-08-01T00:00:00Z',
  });

  test('the same chapter, path and ratio is the same place', () => {
    expect(samePlace(at(2, [3, 1], 0.25), at(2, [3, 1], 0.25))).toBe(true);
  });

  test('when the clock is all that differs, the reader has not moved', () => {
    // A no-op jump re-stamps updatedAt; that is when, not where.
    const before = at(0, [0], 0);
    expect(samePlace(before, { ...before, updatedAt: '2026-08-02T09:00:00Z' })).toBe(true);
  });

  test('a different chapter, element or ratio is somewhere else', () => {
    expect(samePlace(at(2, [3, 1], 0.25), at(3, [3, 1], 0.25))).toBe(false);
    expect(samePlace(at(2, [3, 1], 0.25), at(2, [3, 2], 0.25))).toBe(false);
    expect(samePlace(at(2, [3, 1], 0.25), at(2, [3, 1], 0.5))).toBe(false);
    expect(samePlace(at(2, [3], 0.25), at(2, [3, 1], 0.25))).toBe(false);
  });

  test('an unanchored position matches only another unanchored one', () => {
    const bare: ReadingPosition = { chapter: 1, updatedAt: '2026-08-01T00:00:00Z' };
    expect(samePlace(bare, { ...bare })).toBe(true);
    expect(samePlace(bare, at(1, [0], 0))).toBe(false);
  });

  test('null is a place too: nowhere', () => {
    expect(samePlace(null, null)).toBe(true);
    expect(samePlace(null, at(0, [0], 0))).toBe(false);
    expect(samePlace(at(0, [0], 0), null)).toBe(false);
  });
});
