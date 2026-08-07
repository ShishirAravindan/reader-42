// The chain of open things: one list, in priority order, that answers every
// question about what is on screen.
//
// Escape only ever restores or closes (salvage §4): it closes the topmost open
// thing, else reveals hidden chrome; it never hides anything. Transient
// overlays (nudges, peeks, popovers, cards, menus) come before panels, so a
// press always spends itself on the thing nearest the reader's attention.
//
// The same list answers two more questions, because keeping a second list by
// hand is what let Space turn the page underneath an open Go To panel:
//
//   - What does a PAGE TURN do to an open thing? Each link says so as data —
//     'closes' (a turn input spends itself dismissing this) or 'blocks' (the
//     thing refuses the turn and stays). Either way the page does not move, so
//     taps, swipes and keys agree by construction.
//   - What does OPENING one close? closeOthers(), instead of a hand-copied
//     "close everyone but me" list at each call site.
//
// The order and the policies are data, not control flow: the shell declares
// its chain once as a list and the walks live here, pure and unit-tested.

/** One dismissible thing: transient overlays first, panels after. */
export interface Dismissible {
  isOpen(): boolean;
  close(): void;
}

/**
 * What a page turn does to an open link.
 *
 * - `closes`: the turn input is spent dismissing it — the reader is back in
 *   pure text (parity I1) and the next input turns the page.
 * - `blocks`: it refuses the turn and stays up, because it holds a decision
 *   only the reader can resolve (a scrub origin, a serialized range, unsaved
 *   note text) and turning the page under it would strand or corrupt that.
 */
export type TurnPolicy = 'closes' | 'blocks';

/** One link of the shell's chain: a dismissible plus its rules. */
export interface ChainLink extends Dismissible {
  /** How the shell names this link; closeOthers speaks names, not identity. */
  name: string;
  turn: TurnPolicy;
  /** How a turn dismisses it, when that differs from Escape. */
  dismissForTurn?(): void;
}

/** The first open link in the chain, or null when nothing is open. */
export function firstOpen(chain: Dismissible[]): Dismissible | null {
  return chain.find((item) => item.isOpen()) ?? null;
}

/** Escape only ever restores or closes (salvage §4). */
export function handleEscape(chain: Dismissible[], revealChrome: () => void): void {
  const open = firstOpen(chain);
  if (open) open.close();
  else revealChrome();
}

/** Close every open link but this one; what opening anything means. */
export function closeOthers(chain: ChainLink[], self: string): void {
  for (const link of chain) {
    if (link.name !== self && link.isOpen()) link.close();
  }
}

/**
 * Spend one turn input against the chain. Returns true only when nothing was
 * open at all — the sole case where the page is allowed to move.
 *
 * With something open, the input is spent here: a blocking link refuses it
 * outright (and nothing is dismissed, so a peek's origin and a note's text
 * survive a stray tap), otherwise every open closing link is dismissed. All
 * three input paths call this, so tap, swipe and key cannot diverge.
 */
export function spendTurn(chain: ChainLink[]): boolean {
  if (chain.some((link) => link.turn === 'blocks' && link.isOpen())) return false;
  const closing = chain.filter((link) => link.turn === 'closes' && link.isOpen());
  for (const link of closing) {
    if (link.dismissForTurn) link.dismissForTurn();
    else link.close();
  }
  return closing.length === 0;
}
