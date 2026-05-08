# 0003 — Reader is built from scratch, no EPUB-rendering dependencies

Date: 2026-05-09
Status: Accepted

## Context

Options for the EPUB reader:

- **foliate-js** — most polished open EPUB renderer (powers the Foliate desktop app); large surface
- **epub.js** — most popular browser EPUB lib; weaker typography, complex
- **react-reader** — wraps epub.js; adds React dep
- **From scratch** — parse EPUB zip + opf manifest + spine + nav, render chapter HTML in a sandboxed viewport

User preference (explicit): "no deps as much as possible for the core app (convert obviously will)." Reference for shape: <https://github.com/karpathy/reader3>.

## Decision

Build the reader from scratch in vanilla TS + HTML + CSS:

- Parse EPUB (zip + opf manifest + spine + nav) — small TS module
- Render chapter HTML in a scrollable viewport (sandbox via shadow DOM or scoped CSS)
- Position memory via a CFI-like locator we define
- Highlights via the browser Range API + custom storage
- Font, theme, TOC, search-in-book — implemented directly
- PWA-installable, works offline once an EPUB is loaded

## Rationale

- Smaller deployable surface — PWA stays small and fast to load
- No dependency rot or upstream surprises in the reading-experience layer
- Reader behavior fully under our control — the v2 calibrated-confidence inline markers (per-paragraph flags from `report.json`) require this anyway, and adding markers to a third-party renderer is fighting the abstraction
- Modern coding agents make a from-scratch implementation tractable — months of work compresses dramatically
- karpathy/reader3 demonstrates the minimal viable shape at small line count

## Consequences

- We own all the EPUB edge cases (RTL languages, embedded fonts, complex CSS, footnote popovers). For v1, EPUBs come from *our own convert pipeline*, so the corpus is constrained — we generate them, we render them, edge cases are ours to define and limit.
- Position-locator scheme is bespoke; PKM deep links depend on it being stable. A future ADR will document the locator format once finalized.
- Convert can use deps freely (this constraint is the *core app* — server + reader, not the convert toolbox).
