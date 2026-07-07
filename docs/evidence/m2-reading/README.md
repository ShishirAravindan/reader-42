# Evidence — M2: reading depth (first slice: pagination + typography)

Date: 2026-07-03. Captured live against the served app; the capture run asserts positional behavior programmatically (transcript below).

## Frames

| Frame | What it shows |
|---|---|
| `m2-1-paged.png` | Pages mode engaged from the topbar toggle (Prologue, single page). |
| `m2-2-midpages.png` | Kindle-style page 2 of 7 in Chapter One — folio `p. 2/7` in the footer, right-third tap zone just used to turn the page. |
| `m2-3-typo.png` | The Aa panel: size / measure / leading, set to Wide + Airy in sepia — reflow kept the reading position. |
| `m2-4-tablet-paged-dark.png` | Tablet width, dark theme, paged (`p. 1/10`) — swipe and tap-zone page turns active. |

## Verified behaviors (capture-run assertions)

- **Mode-switch invariance:** at paged `p. 2/7`, the top-of-viewport element was `Passage 2…`; after switching to Scroll the same passage sat at the viewport top — the structural anchor resolving across axes (`OK` in the transcript).
- **Typography reflow keeps position:** applying Wide measure + Airy leading re-laid the chapter; the anchor re-resolved to the same passage.
- **Page navigation:** arrow keys / footer buttons / tap zones (side thirds) / swipe all page within a chapter and cross chapter edges (backward lands on the previous chapter's *last* page).

## Remaining M2 scope

- Bookmarks (list in the sidebar under the TOC, backed by the same anchor locator).
- Per-book font choice was deliberately not added — the serif stack is the aesthetic; revisit only if dogfooding demands.

## Notes

- The fixture book gained 36 paragraphs so pagination has something to paginate (`apps/web/scripts/build-fixture.ts`).
- A paged-mode bug found during capture: clipping columns at the shadow host killed the viewport's scrollWidth; documented in the commit.
