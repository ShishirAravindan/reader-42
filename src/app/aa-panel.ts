// The Aa panel (parity C1–C6, D1): a compact sheet of typography and theme
// controls, opened from the top bar. Every control applies live — theme and
// prefs write immediately, reflowing controls call deps.relayout() so the
// renderer re-reads the ReaderView and restores the reading position. Panel
// rules: outside click closes (and never turns the page), Escape closes it
// before the TOC (wired in reader-shell), the Aa button toggles, and chrome
// stays open underneath. Pure step logic lives at the top, unit-tested; the
// DOM wiring below stays thin and is proven by the demo scene.

import { DISPLAY_MODES, type DisplayMode } from '../reader/mode.ts';
import type { TextAlign } from '../reader/render.ts';
import {
  BOLDNESS_STEPS,
  FONT_FAMILIES,
  FONT_SIZE_STEPS_REM,
  LEADING_STEPS,
  MEASURE_STEPS_CHARS,
  THEMES,
  getAlign,
  getBoldness,
  getFontFamily,
  getFontSizeIndex,
  getLeading,
  getMeasureChars,
  getTheme,
  setAlign,
  setBoldness,
  setFontFamily,
  setFontSizeIndex,
  setLeading,
  setMeasureChars,
  setTheme,
} from './prefs.ts';
import { applyTheme } from './theme.ts';

// --- pure step logic ---

export function stepFontSize(index: number, delta: number): number {
  return Math.min(Math.max(index + delta, 0), FONT_SIZE_STEPS_REM.length - 1);
}

/** False at the ends of the size range: the stepper button disables there. */
export function canStepFontSize(index: number, delta: number): boolean {
  return stepFontSize(index, delta) !== index;
}

// --- labels ---

const THEME_LABELS: Record<(typeof THEMES)[number], string> = {
  paper: 'Paper',
  white: 'White',
  sepia: 'Sepia',
  dark: 'Dark',
};

const FONT_LABELS: Record<(typeof FONT_FAMILIES)[number], string> = {
  publisher: 'Publisher default',
  literata: 'Literata',
  atkinson: 'Atkinson Hyperlegible',
  opendyslexic: 'OpenDyslexic',
};

const WEIGHT_LABELS: Record<(typeof BOLDNESS_STEPS)[number], string> = {
  400: 'Regular',
  450: 'Medium',
  500: 'Semibold',
  575: 'Heavy',
};

const LEADING_LABELS: Record<(typeof LEADING_STEPS)[number], string> = {
  1.45: 'Compact',
  1.65: 'Normal',
  1.9: 'Relaxed',
};

/** Labeled by MARGINS, Kindle-style: the biggest measure is the narrowest margin. */
const MARGIN_LABELS: Record<(typeof MEASURE_STEPS_CHARS)[number], string> = {
  60: 'Wide',
  66: 'Medium',
  74: 'Narrow',
};

const ALIGN_LABELS: Record<TextAlign, string> = { left: 'Left', justify: 'Justified' };

const LAYOUT_LABELS: Record<DisplayMode, string> = { paged: 'Paged', scroll: 'Scroll' };

// --- the panel ---

export interface AaPanelDeps {
  /** Reflow the open book; the renderer preserves the reading position. */
  relayout(): void;
  /** Paged or scroll: taste, so it lives here with margins and spacing. */
  displayMode(): DisplayMode;
  /**
   * Switch layout. The shell owns the whole switch — it reflows AND re-judges
   * the bookmark ribbon against the new geometry, in that order — so this one
   * is NOT wrapped in the panel's reflow helper.
   */
  setDisplayMode(mode: DisplayMode): void;
  /** Called when the panel opens (the shell closes the TOC here). */
  onOpen?(): void;
}

export interface AaPanel {
  isOpen(): boolean;
  close(): void;
}

export function createAaPanel(
  panel: HTMLElement,
  toggle: HTMLButtonElement,
  deps: AaPanelDeps,
): AaPanel {
  const updates: (() => void)[] = [];
  const update = (): void => {
    for (const u of updates) u();
  };

  const group = (label: string, ...rows: HTMLElement[]): HTMLElement => {
    const g = document.createElement('div');
    g.className = 'aa-group';
    const l = document.createElement('span');
    l.className = 'aa-label';
    l.textContent = label;
    g.append(l, ...rows);
    return g;
  };

  const row = (...children: Element[]): HTMLElement => {
    const r = document.createElement('div');
    r.className = 'aa-row';
    r.append(...children);
    return r;
  };

  /** A set of mutually exclusive buttons; the current one wears aria-pressed. */
  function choices<T>(opts: {
    values: readonly T[];
    label(value: T): string;
    current(): T;
    apply(value: T): void;
    decorate?(value: T, button: HTMLButtonElement): void;
  }): HTMLButtonElement[] {
    return opts.values.map((value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.label(value);
      opts.decorate?.(value, b);
      b.onclick = (): void => {
        opts.apply(value);
        update();
      };
      updates.push(() => b.setAttribute('aria-pressed', String(opts.current() === value)));
      return b;
    });
  }

  /**
   * Write a pref, then reflow: the position survives via the anchor cycle.
   *
   * A face switch is the interesting one, and it is deliberately NOT awaited
   * here. The chosen face loads asynchronously, so this reflow measures the
   * column against whatever is on screen at this instant — which, the first
   * time a face is chosen, is still the fallback. The second pass belongs to
   * the renderer (`relayoutWhenFaceArrives` in render.ts), where it also
   * covers the cold open and any future caller; a wait bolted on here would be
   * the same mechanism written twice, and would still miss the cold open.
   */
  const reflow = (write: () => void): void => {
    write();
    deps.relayout();
  };

  const themeButtons = choices({
    values: THEMES,
    label: (t) => THEME_LABELS[t],
    current: getTheme,
    apply: (t) => {
      setTheme(t);
      applyTheme(t); // no reflow: colors never move text
    },
    decorate: (t, b) => {
      b.className = 'aa-swatch';
      // The swatch previews its theme by carrying the data-theme attribute:
      // the token blocks in styles.css scope to it (single source of truth).
      b.dataset.theme = t;
    },
  });

  const fontButtons = choices({
    values: FONT_FAMILIES,
    label: (f) => FONT_LABELS[f],
    current: getFontFamily,
    apply: (f) => reflow(() => setFontFamily(f)),
    // Each row is set in its own face; the class carries the font-family.
    decorate: (f, b) => {
      b.className = `aa-font-row aa-font-${f}`;
    },
  });

  const sizeDown = document.createElement('button');
  sizeDown.type = 'button';
  sizeDown.id = 'aa-size-down';
  sizeDown.textContent = 'A−';
  sizeDown.setAttribute('aria-label', 'Smaller text');
  const sizeUp = document.createElement('button');
  sizeUp.type = 'button';
  sizeUp.id = 'aa-size-up';
  sizeUp.textContent = 'A+';
  sizeUp.setAttribute('aria-label', 'Larger text');
  const dots = document.createElement('div');
  dots.className = 'aa-dots';
  const dotSpans = FONT_SIZE_STEPS_REM.map(() => {
    const s = document.createElement('span');
    dots.appendChild(s);
    return s;
  });
  const stepSize = (delta: number): void => {
    reflow(() => setFontSizeIndex(stepFontSize(getFontSizeIndex(), delta)));
    update();
  };
  sizeDown.onclick = (): void => stepSize(-1);
  sizeUp.onclick = (): void => stepSize(1);
  updates.push(() => {
    const index = getFontSizeIndex();
    sizeDown.disabled = !canStepFontSize(index, -1);
    sizeUp.disabled = !canStepFontSize(index, 1);
    dotSpans.forEach((s, i) => s.classList.toggle('on', i <= index));
  });

  const weightButtons = choices({
    values: BOLDNESS_STEPS,
    label: (w) => WEIGHT_LABELS[w],
    current: getBoldness,
    apply: (w) => reflow(() => setBoldness(w)), // weight can reflow: treat like size
    decorate: (w, b) => {
      b.id = `aa-weight-${w}`;
    },
  });

  const spacingButtons = choices({
    values: LEADING_STEPS,
    label: (l) => LEADING_LABELS[l],
    current: getLeading,
    apply: (l) => reflow(() => setLeading(l)),
    decorate: (l, b) => {
      b.id = `aa-spacing-${LEADING_LABELS[l].toLowerCase()}`;
    },
  });

  const marginButtons = choices({
    values: MEASURE_STEPS_CHARS,
    label: (m) => MARGIN_LABELS[m],
    current: getMeasureChars,
    apply: (m) => reflow(() => setMeasureChars(m)),
    decorate: (m, b) => {
      b.id = `aa-margins-${MARGIN_LABELS[m].toLowerCase()}`;
    },
  });

  const alignButtons = choices({
    values: ['left', 'justify'] as const,
    label: (a) => ALIGN_LABELS[a],
    current: getAlign,
    apply: (a) => reflow(() => setAlign(a)),
    decorate: (a, b) => {
      b.id = `aa-align-${a}`;
    },
  });

  const layoutButtons = choices({
    values: DISPLAY_MODES,
    label: (m) => LAYOUT_LABELS[m],
    current: deps.displayMode,
    apply: (m) => deps.setDisplayMode(m),
    decorate: (m, b) => {
      b.id = `aa-layout-${m}`;
    },
  });

  panel.replaceChildren(
    group('Theme', row(...themeButtons)),
    group('Font', ...fontButtons.map((b) => row(b))),
    group('Size', row(sizeDown, dots, sizeUp)),
    group('Weight', row(...weightButtons)),
    group('Spacing', row(...spacingButtons)),
    group('Margins', row(...marginButtons)),
    group('Alignment', row(...alignButtons)),
    // Last, because it is the coarsest choice on the sheet: paged or scroll is
    // the shape of the page, not a property of the type.
    group('Layout', row(...layoutButtons)),
  );

  // Outside click closes and is swallowed: it must never also turn the page
  // or toggle chrome. The Aa button is excluded so its own handler toggles.
  const onDocClick = (event: MouseEvent): void => {
    const path = event.composedPath();
    if (path.includes(panel) || path.includes(toggle)) return;
    event.stopPropagation();
    event.preventDefault();
    close();
  };

  const open = (): void => {
    if (!panel.hidden) return;
    deps.onOpen?.();
    update();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick, true);
  };

  const close = (): void => {
    if (panel.hidden) return;
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
  };

  // onclick assignment, not addEventListener: the button is static app chrome
  // reused across opens, and handlers must not stack.
  toggle.onclick = (): void => {
    if (panel.hidden) open();
    else close();
  };

  return { isOpen: (): boolean => !panel.hidden, close };
}
