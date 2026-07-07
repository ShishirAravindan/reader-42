# Evidence — M3: search & the record

Date: 2026-07-03. Captured live; assertions from the capture-run transcript.

## Frames

| Frame | What it shows |
|---|---|
| `m3-1-library-search.png` | Library-wide full-text search ("patient") — FTS5 snippet with the hit marked, under the book's card. |
| `m3-2-open-at-match.png` | Clicking the match opened Chapter One with "patient" flashed in the prose (highlighter mark). |
| `m3-3-in-book-find.png` | In-book find ("earnest"): 20 hits listed in the sidebar with chapter + snippet; click jumps and flashes. |
| `m3-4-shelf-stats.png` | The shelf as a record: `67% · <1 min` in the accent, from real progress reporting + a reading session. |

## Verified behaviors

- **FTS5 search** indexes spine text at import (server-side extraction); query syntax characters are quoted so they can't break MATCH (tested).
- **Search → reading flow**: a library match opens the book at that chapter and flashes the term in the text.
- **In-book find** runs client-side over the already-parsed book — no server round-trip.
- **Progress** = chapter + in-chapter fraction, PATCHed on a 20s throttle and flushed on leave; **sessions** POST their seconds on back/pagehide (sendBeacon). Shelf renders `%` + total time.
- 21 server tests pass, including search snippets, FTS-injection safety, progress range validation, session accumulation.

## Line held

Search is findability on demand; stats describe the record. No resurfacing, no streaks, no nags.
