# Vision

reader-42 (working name) is a local-first personal reading environment for long-form web and PDF content. It complements an RSS reader (NetNewsWire) for a different kind of reading: deliberate, considered, often book-length.

## Capture

Friction-calibrated: a paste-URL box (single, or binding a multi-part essay series into one EPUB) and a drop-folder watcher for PDFs. No share sheets, no browser extensions. *Friction is the gate that keeps the library from becoming an inbox.*

## Conversion

The core problem and the product's value-add. The bar is **no manual editing of the output**, achieved through an LLM-driven pipeline with a *calibrated-confidence layer* that surfaces uncertainty as per-item user-facing notes. The system tells you what it's unsure about rather than lying or silently failing.

Convert is implemented as a headless Claude Code agent operating in a per-item workspace, with a seed toolbox and an accountability layer of deterministic verify checks. See [`decisions/0002-convert-as-agent.md`](decisions/0002-convert-as-agent.md).

## Reading

Table-stakes EPUB reader: highlights, font/theme controls, TOC, bookmarks, stable positions. Built from scratch in vanilla TS/HTML/CSS — no EPUB-rendering dependencies — so the core app stays a small, fast PWA. See [`decisions/0003-reader-no-deps.md`](decisions/0003-reader-no-deps.md).

## Library

A flat, simple record of what you've engaged with. Items move: *captured → converting → ready → reading → finished | DNF*, with orthogonal tags for *paused* (resumable) and *quarantined* (verify failed; needs acknowledgment to open). No knowledge graph, no smart resurfacing — that's the PKM's job.

## Highlights

Exit ramp to a PKM (Logseq, Obsidian). Thin export: highlighted text, optional note, chapter/location, deep link back into the EPUB at that position. The tool is the durable archive those links return to.

(Export itself is deferred from v1; the data model accommodates it from day one.)

## v1 scope

Local-only on the user's Mac. Single user, no auth, no remote. Cloud + auth deferred until local is the bottleneck.
