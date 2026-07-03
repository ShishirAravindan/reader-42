# Vision

reader-42 (working name) is a local-first personal reading environment: a custom-built Kindle clone — **library, EPUB reader, and highlights off-ramp** — for deliberate, considered, often book-length reading. It complements an RSS reader (NetNewsWire) for a different kind of reading.

reader-42 begins where a finished EPUB exists. Getting from a URL or PDF *to* that EPUB is the whole job of [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub), a sibling project. The interface between them is deliberately the thinnest possible: an EPUB file, imported by hand. See [`decisions/0005-rescope-library-reader-highlights.md`](decisions/0005-rescope-library-reader-highlights.md).

## Ingest

Manual import only: drag-drop or file picker in the library UI. No watchers, no endpoints, no share sheets. Every book in the library got there by a deliberate act — *friction is the gate that keeps the library from becoming an inbox*. EPUBs typically arrive from reflow-to-epub, but anything valid works (Standard Ebooks, purchased DRM-free books, Calibre exports).

## Library

A flat, simple record of what you've engaged with. Items move: *unread → reading → finished | DNF*. Metadata (title, author) is read from the EPUB itself at import. No knowledge graph, no smart resurfacing — that's the PKM's job.

## Reading

The heart of the product. A from-scratch EPUB reader in vanilla TS/HTML/CSS — no EPUB-rendering dependencies — so the core app stays a small, fast PWA (see [`decisions/0003-reader-no-deps.md`](decisions/0003-reader-no-deps.md)). Two display modes, user-toggleable: continuous scroll (built first) and Kindle-style pagination. Positions are stable and mode-independent — anchored to document structure, not pixels — because bookmarks, progress, and highlight deep links all hang off them.

## Enhancements — the "better than Kindle" layer

Prioritized, in order:

1. **Search** — full-text, in-book and across the library (SQLite FTS5).
2. **Reading stats & progress** — sessions, time-in-book, % complete, finished/DNF history. The record of engagement made visible.
3. **Typography & theme depth** — real control over font, size, measure, leading, margins; light/sepia/dark themes; the polish level Kindle never reaches.

## Highlights

Exit ramp to **Logseq**. Thin export: highlighted text, optional note, chapter/location, deep link back into the EPUB at that position. reader-42 is the durable archive those links return to; the graph work happens in Logseq. (Export ships after the core is dogfoodable; the data model accommodates it from day one.)

## Devices & locality

The server runs on the user's Mac; the reader is a PWA served over the LAN, so an iPad, Android tablet, or phone on the same network is a first-class reading surface. **No cloud backend** — no Convex/Supabase/hosted-sync layer. The library is a SQLite file on the user's machine; that locality is the telos, not a v1 shortcut. If away-from-home reading ever becomes real, it will be solved at the network layer (e.g. Tailscale), not by re-architecting.

## v1 scope

Single user, no auth, local network only. See [`roadmap.md`](roadmap.md) for milestones.
