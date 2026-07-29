// Applying the page-color theme (parity D1). The theme is a data-theme
// attribute on the root element; every color in the app AND inside the
// chapter shadow resolves from the [data-theme] token blocks in styles.css.
// This module never knows a color value — the browser's theme-color meta is
// filled by reading the resolved --bg token back, so the stylesheet stays the
// single source of truth.

import type { Theme } from './prefs.ts';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (bg && meta) meta.setAttribute('content', bg);
}
