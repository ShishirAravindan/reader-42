# Roadmap

Execution milestones for the re-scoped reader-42 (library + reader + highlights; see [ADR 0005](decisions/0005-rescope-library-reader-highlights.md)). Each milestone is several conventional-prefix PRs plus a **milestone evidence doc** — shot-scraper screenshots/recordings of the real flows, open questions, and what's next — placed under `docs/evidence/<milestone>/` for asynchronous user review. Blocking decisions are batched and asked up front per milestone; everything else runs autonomously.

## M0 — Restructure *(this change)*

Re-scope docs (vision, non-goals, CLAUDE.md, ADR 0005), delete convert/capture code and the workspace template, simplify the schema to `unread → reading → finished | dnf`. No evidence doc (no user-visible behavior yet).

## M1 — Dogfoodable core

The walking skeleton: a book gets in, gets read, position survives.

> **Status 2026-07-03:** core landed — import + shelf UI, one-process serving, structural position anchor (restore verified across reload; font-size reflow re-anchors), 14 server tests. Evidence: `docs/evidence/m1-core/`. The paper-and-ink aesthetic was adopted ahead of schedule, so the mockup checkpoint becomes variant tuning (see evidence README's open questions).

- **Import**: `POST /library/import` (multipart) + drag-drop and file-picker in the library UI; title/author parsed from the EPUB's OPF; file stored under `data/epubs/`. Reject invalid EPUBs with a clear message.
- **Library UI**: list of books (title, author, state, imported date); state transitions (`unread → reading → finished | dnf`); open a book into the reader.
- **Serve the reader from the server**: `apps/web` served by the Hono app on `:4242` (currently a standalone dev server), reachable from LAN devices.
- **Scroll reading mode** with stable, mode-independent position memory (spine item + element path + offset — designed in M1 so M2's pagination reuses it).
- **Aesthetic mockups** *(review checkpoint)*: 2–3 styled variants of the library + reader rendered as real pages, captured with shot-scraper into the evidence doc; user picks the direction before M2 polish.

Exit: import a real reflow-to-epub EPUB, read it across two sessions on desktop + a tablet-sized viewport, position holds. Evidence doc: `docs/evidence/m1-core/`.

## M2 — Reading experience depth

The Kindle-clone feel, in the chosen aesthetic.

- Paginated display mode, user-toggleable with scroll (positions survive the switch).
- Typography controls: font, size, measure, leading, margins; per-book overrides.
- Themes: light / sepia / dark.
- TOC navigation + bookmarks.
- Touch gestures + responsive layout for tablet reading (tap zones, swipe page turns).

Evidence doc: `docs/evidence/m2-reading/`.

## M3 — Search + reading stats

The first two "better than Kindle" enhancements (user-prioritized).

> **Status 2026-07-07: shipped.** FTS5 library search with open-at-match, in-book find with flash, progress % + reading time on the shelf. Evidence: `docs/evidence/m3-search-stats/`.

- Full-text search in-book and across the library (SQLite FTS5; index built at import).
- Reading sessions, time-in-book, % complete, finished/DNF history surfaced in the library.

Evidence doc: `docs/evidence/m3-search-stats/`.

## M4 — Highlights + Logseq off-ramp

> **Status 2026-07-07: shipped.** Range highlights with notes on the structural locator, server-stored, deep links (`#/book/:id/hl/:hid`), `logseq.md` export. Evidence: `docs/evidence/m4-highlights/`.

- Highlights via Range API on top of the position locator; optional notes.
- Deep links back into the book at the highlight's position.
- Thin markdown export to a Logseq graph (highlight text, note, chapter/location, deep link).

Evidence doc: `docs/evidence/m4-highlights/`.

## Later / explicitly deferred

- Away-from-home reading → Tailscale, not a cloud backend (see non-goals).
- Surfacing reflow-to-epub conversion reports at import time.
- Cover art in the library grid, series grouping, OPDS — only if dogfooding demands them.
