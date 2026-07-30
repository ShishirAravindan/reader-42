// The Escape chain: one press, one dismissal, in a fixed order.
//
// Escape only ever restores or closes (salvage §4): it closes the topmost open
// thing, else reveals hidden chrome; it never hides anything. Transient
// overlays (nudges, peeks, popovers, cards, menus) come before panels, so a
// press always spends itself on the thing nearest the reader's attention.
//
// The order is data, not control flow: the shell declares its chain once as a
// list and the walk lives here, where it is pure and unit-tested.

/** One dismissible thing: transient overlays first, panels after. */
export interface Dismissible {
  isOpen(): boolean;
  close(): void;
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
