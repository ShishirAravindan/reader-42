# 0005 — Re-scope: reader-42 is the library, reader, and highlights off-ramp

Date: 2026-07-03
Status: Accepted
Supersedes: [0002](0002-convert-as-agent.md), [0004](0004-convert-workspace-shape.md)

## Context

reader-42 was conceived as the whole path: capture → convert → read → export, with conversion declared the value-add. That conversion concern was extracted into a sibling repo, [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub), which has since evolved its own, different design (agent-in-loop plugin, promoted CLI primitives, an issue-driven promotion loop) and explicitly chose *not* to lift reader-42's convert code ("carry lessons, not code — clean slate"). reader-42's convert worker, workspace template, and verify toolbox were never run on real documents.

That left reader-42 carrying a dead identity: vision, ADRs, CLAUDE.md, DB states, routes, and a whole workspace template for a concern that now lives elsewhere.

## Decision

### Scope

reader-42 is a **personal Kindle clone**: library + from-scratch EPUB reader + highlights off-ramp to Logseq. Nothing upstream of a finished EPUB is in scope. Further pieces may be broken out later if a concern grows its own gravity.

### Ingest: manual UI import only

Drag-drop / file picker in the library UI. No drop-folder watcher, no import HTTP endpoint, no coupling to reflow-to-epub beyond "it produces an EPUB; the user imports it." Rationale: every import is a deliberate act (the friction-as-gate principle, relocated from capture to import), and the contract stays exactly as thin as reflow-to-epub's README already states — "no contract beyond 'import an EPUB'."

### Convert code: deleted

`apps/server/src/convert/`, `routes/capture.ts`, `convert-workspace-template/` (including the verify toolbox and its tests), and the conversion-lifecycle DB states (`captured`, `converting`, `paused`, `quarantined`, workspace/report paths) are removed in the re-scope change. Git history preserves them; nothing was lifted into reflow-to-epub by design.

### Item lifecycle

`unread → reading → finished | dnf`. Metadata (title/author) read from the EPUB's OPF at import.

### Reading model: scroll first, pagination as a toggle

Continuous scroll ships first (simpler, robust); Kindle-style pagination follows as a user-toggleable display mode. Consequence accepted up front: the position-locator scheme must be **mode-independent** — anchored to document structure (spine item + element path + character offset), never to scroll offsets or page numbers — since bookmarks, progress, and highlight deep links must survive mode switches.

### Devices: LAN PWA, no cloud backend

The Hono server on the user's Mac serves the reader PWA to any device on the LAN — iPad, Android tablet, phone — so responsive layout and touch gestures are first-class. Cloud-reactive backends (Convex was considered) are **rejected**: they invert local-first, add a hosted dependency to a deliberately no-deps core, and solve a sync problem a single-user LAN product doesn't have. If away-from-home reading becomes real, reach for the network layer (Tailscale) — zero architecture change — before any backend rework.

### Highlights export target: Logseq

Thin markdown/outline export with deep links back into the reader. Ships after the dogfoodable core (see `docs/roadmap.md`).

### Operating model: milestone evidence docs

Development runs autonomously through PRs; at each roadmap milestone the agent produces an evidence doc (shot-scraper screenshots/recordings of real flows) for user review. Aesthetic direction is decided **mockups-first**: styled variants of real pages, captured and compared, not adjectives.

## Consequences

- **The reader is now the value center.** ADR 0002's premise ("convert is the technically hard part; reader is table stakes") is inverted — engineering effort goes to reading experience, typography, positions, search.
- **ADR 0003 consequence weakened:** "EPUBs come from our own convert pipeline, so the corpus is constrained" no longer holds. Imported EPUBs may come from anywhere; the reader must degrade gracefully on wild EPUBs rather than assume a quarantine gate upstream.
- The `report.json` / calibrated-confidence surface leaves this repo with conversion. If reflow-to-epub ever ships reports alongside EPUBs, surfacing them could return as an import-time nicety — explicitly not planned now.
- ADRs 0002 and 0004 are superseded; their ideas live on, transformed, in reflow-to-epub's own design docs.
