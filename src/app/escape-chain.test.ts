import { describe, expect, test } from 'bun:test';
import {
  type ChainLink,
  type Dismissible,
  type TurnPolicy,
  closeOthers,
  firstOpen,
  handleEscape,
  spendTurn,
} from './escape-chain.ts';

/** A chain link that records its own closes. */
function link(name: string, open: boolean, log: string[]): Dismissible & { open: boolean } {
  const item = {
    open,
    isOpen: (): boolean => item.open,
    close: (): void => {
      log.push(name);
      item.open = false;
    },
  };
  return item;
}

/** The same, carrying the turn policy the shell declares. */
function policyLink(
  name: string,
  open: boolean,
  turn: TurnPolicy,
  log: string[],
  dismissForTurn?: (item: { open: boolean }) => void,
): ChainLink & { open: boolean } {
  const item: ChainLink & { open: boolean } = {
    name,
    turn,
    open,
    isOpen: (): boolean => item.open,
    close: (): void => {
      log.push(name);
      item.open = false;
    },
    ...(dismissForTurn
      ? {
          dismissForTurn: (): void => {
            log.push(`${name}:turn`);
            dismissForTurn(item);
          },
        }
      : {}),
  };
  return item;
}

describe('firstOpen', () => {
  test('respects the declared order, not what opened last', () => {
    const log: string[] = [];
    const card = link('card', true, log);
    const panel = link('panel', true, log);
    expect(firstOpen([card, panel])).toBe(card);
    expect(firstOpen([panel, card])).toBe(panel);
  });

  test('skips closed links', () => {
    const log: string[] = [];
    const panel = link('panel', true, log);
    expect(firstOpen([link('card', false, log), panel])).toBe(panel);
  });

  test('nothing open, nothing found', () => {
    const log: string[] = [];
    expect(firstOpen([link('card', false, log), link('panel', false, log)])).toBeNull();
    expect(firstOpen([])).toBeNull();
  });
});

describe('handleEscape', () => {
  test('closes only the first open thing, and never reveals chrome as well', () => {
    const log: string[] = [];
    const card = link('card', true, log);
    const panel = link('panel', true, log);
    let revealed = 0;
    handleEscape([card, panel], () => {
      revealed += 1;
    });
    expect(log).toEqual(['card']);
    expect(panel.isOpen()).toBe(true);
    expect(revealed).toBe(0);
  });

  test('successive presses walk down the chain', () => {
    const log: string[] = [];
    const chain = [link('card', true, log), link('panel', true, log)];
    let revealed = 0;
    const press = (): void => {
      handleEscape(chain, () => {
        revealed += 1;
      });
    };
    press();
    press();
    press();
    expect(log).toEqual(['card', 'panel']);
    expect(revealed).toBe(1);
  });

  test('with nothing open the press restores chrome', () => {
    const log: string[] = [];
    let revealed = 0;
    handleEscape([link('card', false, log)], () => {
      revealed += 1;
    });
    expect(log).toEqual([]);
    expect(revealed).toBe(1);
  });

  test('an empty chain is safe', () => {
    let revealed = 0;
    handleEscape([], () => {
      revealed += 1;
    });
    expect(revealed).toBe(1);
  });
});

describe('closeOthers', () => {
  test('opening one thing closes every other open thing', () => {
    const log: string[] = [];
    const chain = [
      policyLink('card', true, 'closes', log),
      policyLink('goto', false, 'closes', log),
      policyLink('notebook', true, 'closes', log),
      policyLink('aa', true, 'blocks', log),
    ];
    closeOthers(chain, 'notebook');
    expect(log).toEqual(['card', 'aa']);
    expect(chain[2]?.isOpen()).toBe(true);
  });

  test('the turn policy has no say in what opening closes', () => {
    const log: string[] = [];
    const chain = [policyLink('peek', true, 'blocks', log)];
    closeOthers(chain, 'goto');
    expect(log).toEqual(['peek']);
  });

  test('a name that is not in the chain closes everything open', () => {
    const log: string[] = [];
    closeOthers([policyLink('a', true, 'closes', log), policyLink('b', false, 'closes', log)], 'z');
    expect(log).toEqual(['a']);
  });
});

describe('spendTurn', () => {
  test('with nothing open the page is free to turn', () => {
    const log: string[] = [];
    const chain = [
      policyLink('card', false, 'closes', log),
      policyLink('peek', false, 'blocks', log),
    ];
    expect(spendTurn(chain)).toBe(true);
    expect(log).toEqual([]);
  });

  test('a closing link spends the turn dismissing itself: the page stays put', () => {
    const log: string[] = [];
    const chain = [policyLink('footnote', true, 'closes', log)];
    expect(spendTurn(chain)).toBe(false);
    expect(log).toEqual(['footnote']);
    // The reader is back in pure text, so the NEXT input turns.
    expect(spendTurn(chain)).toBe(true);
  });

  test('a blocking link refuses the turn and dismisses nothing', () => {
    const log: string[] = [];
    const peek = policyLink('peek', true, 'blocks', log);
    const chain = [policyLink('footnote', true, 'closes', log), peek];
    expect(spendTurn(chain)).toBe(false);
    // LOAD-BEARING: a stray swipe must not shred a scrub origin or a
    // serialized range, and must not quietly close its neighbours either.
    expect(log).toEqual([]);
    expect(peek.isOpen()).toBe(true);
  });

  test('every open closing link goes, not just the topmost', () => {
    const log: string[] = [];
    const chain = [
      policyLink('nudge', true, 'closes', log),
      policyLink('dict', true, 'closes', log),
      policyLink('goto', true, 'closes', log),
    ];
    expect(spendTurn(chain)).toBe(false);
    expect(log).toEqual(['nudge', 'dict', 'goto']);
  });

  test('dismissForTurn overrides close, for links that leave something behind', () => {
    const log: string[] = [];
    const search = policyLink('search', true, 'closes', log, (item) => {
      item.open = false;
    });
    expect(spendTurn([search])).toBe(false);
    expect(log).toEqual(['search:turn']); // the find marks stay lit
  });

  test('an empty chain never blocks a turn', () => {
    expect(spendTurn([])).toBe(true);
  });
});
