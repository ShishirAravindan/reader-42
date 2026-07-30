// The two display modes of the reading surface. Paged (CSS columns, the
// default) and continuous scroll; positions survive the switch because
// locators are axis-independent.

export const DISPLAY_MODES = ['paged', 'scroll'] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];
