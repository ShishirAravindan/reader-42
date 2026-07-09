# Evidence — M1: the dogfoodable core

Date: 2026-07-03. Captured live from the app served by `apps/server` on `:4242` (headless Chromium driving the real UI — no mocks; the import goes through the actual file input, the book through the actual API).

## The flow

| Frame | What it shows |
|---|---|
| `m1-1-empty.png` | The shelf, empty. Import is the only door: a button and a drop target. |
| `m1-2-imported.png` | After dropping the fixture EPUB: title/author read from the OPF, state Unread, import toast. |
| `m1-3-reading.png` | Opened into the reader (light theme, desktop). |
| `m1-4-shelf-reading.png` | Back on the shelf: opening an unread book moved it to Reading automatically — the shelf is a record. |
| `m1-5-restored.png` | After a full page reload and reopen: chapter and scroll restored. |
| `m1-6-tablet-dark.png` | Tablet-width viewport, dark theme, same server — the LAN posture. |

## Verified behaviors (from the capture run's assertions)

- **Position restore:** reload → reopen landed on `2 of 3: Chapter One`, scroll 75/75 — exact.
- **Structural anchor:** bumping font size re-anchored scroll 75 → 80, i.e. the position followed the *paragraph*, not the pixel (ADR 0005's mode-independent locator, first implementation).
- **Import validation:** non-EPUB uploads rejected with 422 and a plain message (covered by `apps/server/test/`).

## Open questions for review

1. Shelf card density and shape — happy to render variants (tighter list, cover thumbnails when present, grouping by state) for the M1 aesthetic-tuning checkpoint.
2. Should *finished/DNF* books visually recede on the shelf (muted card) or stay equal-weight?
3. Auto-transition unread→reading on open: keep, or require a manual move?

## Notes

- 14 server tests pass (`bun test`): import, metadata extraction, state transitions, static serving, traversal guard.
- Renderer regression (infinite loop on chapter mount) is fixed and exercised implicitly by every capture; a DOM-level unit test still wants a browser test harness — tracked for M2's Playwright setup.
