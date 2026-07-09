# Evidence — dogfooding friction fixes

Date: 2026-07-07. A dogfooding agent walked every flow as a first-time reader against `aec7d1f` (local tag `dogfood-demo-v0`), recorded a 1:03 e2e video, and filed a ranked friction log. This pack verifies the fixes; the verification suite re-tests each finding end-to-end.

## Verification transcript (all OK)

1. **Duplicate import**: re-importing the same EPUB → 1 card, toast "already on your shelf" (content-hash dedupe).
2. **Same-paragraph highlights survive reload**: 2 marks before and after (locator paths now computed against mark-free structure).
3. **Browser Back** returns to the shelf (hashchange listener).
4. **PageDown scrolls in scroll mode**: 0 → 566px (explicit viewport scrolling for Space/arrows/Page keys).
5. **Idle desktop click no longer hides chrome** (scroll-mode clicks only *restore*; hiding is the ⛶ button, paged/touch center-tap).
6. **⛶ + Esc**: immersive on via button, chrome back via Escape (Escape now only ever restores/closes).
7. **Finished book**: server progress = 1, end-of-book toast shown (was 0% with no feedback).
8. **Cross-device position sync**: a fresh browser context opened the book at `3 of 3: Epilogue` from the server-synced position (was: always Prologue, progress wars between devices).

Also fixed: highlight-jump pulse, stronger note underline (2px dotted), shelf stats labeled "read", favicon, portrait-tablet sidebar defaults closed, Logseq export uses chapter titles, friendlier import errors, deep-link URLs stay copyable.

## Deliberately not changed

- Typography/theme prefs stay per-device (taste is device-local; position is not).
- Overlapping duplicate highlights of the same text remain allowed.
