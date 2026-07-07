# Evidence — M4: highlights & the Logseq off-ramp

Date: 2026-07-07. Captured live; assertions from the capture-run transcript.

## Frames

| Frame | What it shows |
|---|---|
| `m4-1-popover.png` | Text selected in the prose; the Highlight / + Note popover floating at the selection. |
| `m4-2-note.png` | The note panel over a fresh highlight. |
| `m4-3-sidebar.png` | Two highlights painted in the text (dashed underline = has note) and listed in the sidebar with note previews. |
| `m4-4-deeplink.png` | The book opened directly from a `#/book/:id/hl/:hid` deep link — the reader lands on the highlight. |

## Verified behaviors

- **Create**: select → popover → Highlight or + Note; the span is wrapped per text-node so highlights can cross element boundaries.
- **Locator**: highlights serialize to element-index paths + character offsets — the same locator family as positions, stable across display modes and typography changes.
- **Persistence**: stored server-side (`highlights` table); after a full reload the marks repaint (asserted: 2/2).
- **Deep links**: `#/book/:id/hl/:hid` reopens the book at the highlight (asserted).
- **Logseq export**: `GET /library/:id/logseq.md` produces an outline per book — quoted text, `chapter::`, `link::` (deep link), `note::` properties. 27 server tests cover CRUD + export format.

## The off-ramp contract

The export is deliberately thin: markdown properties Logseq ingests natively, with links that resolve as long as the server runs on the LAN. reader-42 remains the durable archive the links return to.

## Open questions

1. Export currently downloads a file; writing directly into a Logseq graph folder (env-configured path) is a small follow-up if the download step chafes.
2. Highlight colors: one amber for now — worth variants?
