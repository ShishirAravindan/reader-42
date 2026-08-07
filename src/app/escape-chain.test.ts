import { describe, expect, test } from 'bun:test';
import { type Dismissible, firstOpen, handleEscape } from './escape-chain.ts';

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
