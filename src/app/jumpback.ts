// The jump-back stack (parity H3): every in-book jump that is not a page turn
// leaves a way back to where you were reading.
//
// The rules, as Kindle behaves: the pill appears on the jump and names the
// place you came from ("Back to Loc 412"); tapping it returns you and reveals
// the next one down; and it gets out of the way once you have settled into
// reading — three page turns is the signal — WITHOUT forgetting the stack,
// which lives as long as the book is open. Deep-link opens push nothing:
// there is no "back" to a place you were never at.
//
// All of that is state, not DOM, so it lives here and is unit-tested; the
// shell owns the button.

import type { ReadingPosition } from '../library/types.ts';

/** Deeper than this and the stack is a history, not an escape hatch. */
export const BACK_STACK_CAP = 10;
/** Page turns after a jump before the pill considers you settled. */
export const PILL_HIDES_AFTER_TURNS = 3;

export interface JumpBackEntry {
  position: ReadingPosition;
  /** The location number of the place jumped from; the pill's label. */
  location: number;
}

export interface JumpBackState {
  visible: boolean;
  /** Null when the stack is empty. */
  entry: JumpBackEntry | null;
}

export interface JumpBack {
  /** Record where a jump started; shows the pill. */
  push(entry: JumpBackEntry): void;
  /** Take the most recent entry (the caller restores it). */
  pop(): JumpBackEntry | null;
  /** Count a page turn: three of them settle the pill out of sight. */
  turn(): void;
  state(): JumpBackState;
}

export function createJumpBack(): JumpBack {
  const stack: JumpBackEntry[] = [];
  let visible = false;
  let turnsSinceJump = 0;

  const top = (): JumpBackEntry | null => stack[stack.length - 1] ?? null;

  return {
    push(entry: JumpBackEntry): void {
      stack.push(entry);
      // Oldest out: a jump from ten jumps ago is not somewhere anyone returns.
      while (stack.length > BACK_STACK_CAP) stack.shift();
      visible = true;
      turnsSinceJump = 0;
    },
    pop(): JumpBackEntry | null {
      const entry = stack.pop() ?? null;
      turnsSinceJump = 0;
      // Returning is itself an arrival: the next way back stays offered.
      visible = stack.length > 0;
      return entry;
    },
    turn(): void {
      if (!visible) return;
      turnsSinceJump += 1;
      if (turnsSinceJump >= PILL_HIDES_AFTER_TURNS) visible = false;
    },
    state: (): JumpBackState => ({ visible: visible && stack.length > 0, entry: top() }),
  };
}

export function jumpBackLabel(entry: JumpBackEntry): string {
  return `Back to Loc ${entry.location.toLocaleString('en-US')}`;
}
