import { describe, expect, test } from 'bun:test';
import { SWIPE_MIN_PX, attachReadingInput, swipeTurn, turnForKey, zoneFor } from './input.ts';

describe('zoneFor', () => {
  test('kindle zone geometry: left third back, right third forward, center chrome', () => {
    expect(zoneFor(0, 1000, 'ltr')).toBe('back');
    expect(zoneFor(329, 1000, 'ltr')).toBe('back');
    expect(zoneFor(330, 1000, 'ltr')).toBe('chrome');
    expect(zoneFor(500, 1000, 'ltr')).toBe('chrome');
    expect(zoneFor(660, 1000, 'ltr')).toBe('chrome');
    expect(zoneFor(661, 1000, 'ltr')).toBe('forward');
    expect(zoneFor(999, 1000, 'ltr')).toBe('forward');
  });

  test('mirrors for rtl, center stays chrome', () => {
    expect(zoneFor(100, 1000, 'rtl')).toBe('forward');
    expect(zoneFor(500, 1000, 'rtl')).toBe('chrome');
    expect(zoneFor(900, 1000, 'rtl')).toBe('back');
  });

  test('degenerate width is chrome, never an accidental turn', () => {
    expect(zoneFor(10, 0, 'ltr')).toBe('chrome');
  });
});

describe('turnForKey', () => {
  test('space, page keys, and arrows', () => {
    expect(turnForKey(' ', false, 'ltr')).toBe('forward');
    expect(turnForKey(' ', true, 'ltr')).toBe('back');
    expect(turnForKey('PageDown', false, 'ltr')).toBe('forward');
    expect(turnForKey('PageUp', false, 'ltr')).toBe('back');
    expect(turnForKey('ArrowRight', false, 'ltr')).toBe('forward');
    expect(turnForKey('ArrowLeft', false, 'ltr')).toBe('back');
  });

  test('arrows mirror for rtl; page/space keys do not', () => {
    expect(turnForKey('ArrowRight', false, 'rtl')).toBe('back');
    expect(turnForKey('ArrowLeft', false, 'rtl')).toBe('forward');
    expect(turnForKey('PageDown', false, 'rtl')).toBe('forward');
    expect(turnForKey(' ', false, 'rtl')).toBe('forward');
  });

  test('other keys are not turns', () => {
    expect(turnForKey('a', false, 'ltr')).toBeNull();
    expect(turnForKey('Enter', false, 'ltr')).toBeNull();
    expect(turnForKey('Escape', false, 'ltr')).toBeNull();
  });
});

describe('swipeTurn', () => {
  test('horizontal swipes past the threshold turn; left = forward in ltr', () => {
    expect(swipeTurn(-80, 4, 'ltr')).toBe('forward');
    expect(swipeTurn(80, -4, 'ltr')).toBe('back');
    expect(swipeTurn(-80, 4, 'rtl')).toBe('back');
    expect(swipeTurn(80, 4, 'rtl')).toBe('forward');
  });

  test('short or mostly-vertical drags are not turns', () => {
    expect(swipeTurn(-SWIPE_MIN_PX, 0, 'ltr')).toBeNull();
    expect(swipeTurn(-80, -90, 'ltr')).toBeNull();
    expect(swipeTurn(0, 200, 'ltr')).toBeNull();
  });
});

describe('attachReadingInput', () => {
  function harness(dir: 'ltr' | 'rtl' = 'ltr', keysEnabled = true) {
    const viewport = document.createElement('div');
    document.body.appendChild(viewport);
    // jsdom does no layout; give the viewport a real rect for zone math.
    viewport.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 }) as DOMRect;
    const events: string[] = [];
    const detach = attachReadingInput(viewport, {
      dir: () => dir,
      onTurn: (d) => events.push(d),
      onChrome: () => events.push('chrome'),
      keysEnabled: () => keysEnabled,
    });
    return { viewport, events, detach };
  }

  test('clicks map to zones', () => {
    const { viewport, events, detach } = harness();
    viewport.dispatchEvent(new MouseEvent('click', { clientX: 850, bubbles: true }));
    viewport.dispatchEvent(new MouseEvent('click', { clientX: 50, bubbles: true }));
    viewport.dispatchEvent(new MouseEvent('click', { clientX: 450, bubbles: true }));
    expect(events).toEqual(['forward', 'back', 'chrome']);
    detach();
  });

  test('clicks on links are ignored', () => {
    const { viewport, events, detach } = harness();
    const a = document.createElement('a');
    a.setAttribute('href', 'ch2.xhtml');
    viewport.appendChild(a);
    a.dispatchEvent(new MouseEvent('click', { clientX: 850, bubbles: true }));
    expect(events).toEqual([]);
    detach();
  });

  test('clicks on highlight marks belong to the annotation layer, not the zones', () => {
    const { viewport, events, detach } = harness();
    const mark = document.createElement('mark');
    mark.className = 'hl hl-yellow';
    viewport.appendChild(mark);
    mark.dispatchEvent(new MouseEvent('click', { clientX: 850, bubbles: true }));
    expect(events).toEqual([]);
    // A plain <mark> without the hl class is ordinary book text: zones apply.
    const plain = document.createElement('mark');
    viewport.appendChild(plain);
    plain.dispatchEvent(new MouseEvent('click', { clientX: 850, bubbles: true }));
    expect(events).toEqual(['forward']);
    detach();
  });

  test('document keys turn pages while attached, not after detach', () => {
    const { events, detach } = harness();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true }));
    expect(events).toEqual(['forward', 'back']);
    detach();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    expect(events).toEqual(['forward', 'back']);
  });

  test('keysEnabled=false gates keys but not taps', () => {
    const { viewport, events, detach } = harness('ltr', false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    viewport.dispatchEvent(new MouseEvent('click', { clientX: 850, bubbles: true }));
    expect(events).toEqual(['forward']);
    detach();
  });

  test('keys in editable fields are left alone', () => {
    const { events, detach } = harness();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(events).toEqual([]);
    input.remove();
    detach();
  });
});
