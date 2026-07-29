import { beforeEach, describe, expect, test } from 'bun:test';
import type { PageAnchor } from '../reader/metrics.ts';
import {
  type StatusMode,
  type StatusSource,
  createStatusLine,
  formatLocation,
  formatPage,
  formatPercent,
  formatTimeLeft,
  nextStatusMode,
  pageAt,
} from './status.ts';

describe('nextStatusMode', () => {
  test('cycles through every state and wraps, with a page-list', () => {
    const seen: StatusMode[] = [];
    let mode: StatusMode = 'time-left-chapter';
    for (let i = 0; i < 6; i++) {
      seen.push(mode);
      mode = nextStatusMode(mode, true);
    }
    expect(seen).toEqual([
      'time-left-chapter',
      'time-left-book',
      'location',
      'page',
      'percent',
      'off',
    ]);
    expect(mode).toBe('time-left-chapter'); // wrapped
  });

  test('skips the page state for books without a page-list', () => {
    expect(nextStatusMode('location', false)).toBe('percent');
    expect(nextStatusMode('location', true)).toBe('page');
    // A stale 'page' mode still advances sanely without pages.
    expect(nextStatusMode('page', false)).toBe('time-left-chapter');
  });
});

describe('formatting', () => {
  test('formatTimeLeft covers the Kindle wording', () => {
    expect(formatTimeLeft(null, 'chapter')).toBe('Learning reading speed…');
    expect(formatTimeLeft(0.4, 'chapter')).toBe('Less than a minute left');
    expect(formatTimeLeft(12.3, 'chapter')).toBe('12 min left in chapter');
    expect(formatTimeLeft(59.4, 'book')).toBe('59 min left in book');
    expect(formatTimeLeft(200, 'book')).toBe('3 hr 20 min left in book');
    expect(formatTimeLeft(120.2, 'book')).toBe('2 hr left in book');
  });

  test('formatLocation uses thousands separators', () => {
    expect(formatLocation(214, 1530)).toBe('Loc 214 of 1,530');
    expect(formatLocation(1000000, 2000000)).toBe('Loc 1,000,000 of 2,000,000');
  });

  test('formatPage and formatPercent', () => {
    expect(formatPage('12', '96')).toBe('Page 12 of 96');
    expect(formatPercent(0.337)).toBe('34%');
    expect(formatPercent(-0.5)).toBe('0%');
    expect(formatPercent(1.5)).toBe('100%');
  });
});

describe('pageAt', () => {
  const anchors: PageAnchor[] = [
    { label: '1', globalChar: 0 },
    { label: '2', globalChar: 500 },
    { label: '3', globalChar: 900 },
  ];

  test('picks the last page starting at or before the offset', () => {
    expect(pageAt(anchors, 0)).toEqual({ label: '1', last: '3' });
    expect(pageAt(anchors, 499)).toEqual({ label: '1', last: '3' });
    expect(pageAt(anchors, 500)).toEqual({ label: '2', last: '3' });
    expect(pageAt(anchors, 5000)).toEqual({ label: '3', last: '3' });
  });

  test('empty page-list means no page display', () => {
    expect(pageAt([], 100)).toBeNull();
  });
});

describe('createStatusLine', () => {
  let strip: HTMLElement;
  let button: HTMLButtonElement;
  let right: HTMLElement;

  beforeEach(() => {
    strip = document.createElement('div');
    button = document.createElement('button');
    right = document.createElement('span');
    strip.append(button, right);
  });

  const source = (overrides: Partial<StatusSource> = {}): StatusSource => ({
    progress: () => 0.34,
    location: () => ({ loc: 214, total: 1530 }),
    page: () => ({ label: '12', last: '96' }),
    minutesLeft: () => null,
    ...overrides,
  });

  test('renders immediately and cycles through the states on click', () => {
    const modes: StatusMode[] = [];
    const line = createStatusLine(strip, button, right, source(), 'time-left-chapter', (m) =>
      modes.push(m),
    );
    expect(button.textContent).toBe('Learning reading speed…');
    expect(right.textContent).toBe('34%');

    button.click(); // time-left-book
    button.click(); // location
    expect(button.textContent).toBe('Loc 214 of 1,530');
    button.click(); // page
    expect(button.textContent).toBe('Page 12 of 96');
    button.click(); // percent: right slot would be redundant, shows nothing
    expect(button.textContent).toBe('34%');
    expect(right.textContent).toBe('');
    button.click(); // off: strip hidden except the hit target
    expect(strip.classList.contains('status-off')).toBe(true);
    expect(button.textContent).toBe('');
    expect(right.textContent).toBe('');
    button.click(); // back on
    expect(strip.classList.contains('status-off')).toBe(false);
    expect(line.mode()).toBe('time-left-chapter');
    expect(modes).toEqual([
      'time-left-book',
      'location',
      'page',
      'percent',
      'off',
      'time-left-chapter',
    ]);
  });

  test('a stale page mode for a page-less book degrades to percent', () => {
    const line = createStatusLine(
      strip,
      button,
      right,
      source({ page: () => null }),
      'page',
      () => {},
    );
    expect(line.mode()).toBe('percent');
    expect(button.textContent).toBe('34%');
  });

  test('status clicks do not bubble to the page-turn layer', () => {
    createStatusLine(strip, button, right, source(), 'time-left-chapter', () => {});
    let reached = false;
    strip.addEventListener('click', () => {
      reached = true;
    });
    button.click();
    expect(reached).toBe(false);
  });
});
