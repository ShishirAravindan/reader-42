# Decisions

Dated, append-only log of the decisions that shape reader-42. A few sentences each; changing course costs a new entry, not a supersession chain. Compressed from the original numbered ADRs (`docs/decisions/`, deleted 2026-07-11; full text in git history).

## 2026-05-09 — Stack: TypeScript end-to-end

Bun + Hono server, SQLite via better-sqlite3 + Drizzle (schema is the type source of truth), Zod at every boundary, vanilla TS/HTML/CSS frontend, Biome for lint/format. Why: one language means one agent context and one toolchain; SQLite is right-sized for single-user and brings FTS5 for free; `bun build` keeps single-binary distribution open.

## 2026-05-09 — Reader built from scratch, no EPUB-rendering dependencies

No epub.js, foliate-js, or react-reader. Parse the zip + OPF + spine ourselves, render chapter HTML in a sandboxed viewport. Why: the reader is the product. Full control over typography and locators, no dependency rot, a small fast PWA; coding agents make from-scratch tractable. Cost accepted: we own the EPUB edge cases and must degrade gracefully on wild EPUBs.

## 2026-05-09 — Conversion as a headless agent *(dead end, extracted)*

URL/PDF → EPUB was designed as a headless Claude Code agent in per-item workspaces with a stable verify toolbox. The whole concern was extracted to [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub), which re-derived its own design; the code here was deleted without ever running on real documents. Lesson kept: carry lessons, not code.

## 2026-07-03 — Re-scope: library + reader + highlights off-ramp

Nothing upstream of a finished EPUB is in scope. Manual UI import only (friction as the gate). Item lifecycle *unread → reading → finished | dnf*, metadata from the OPF. Scroll mode first, pagination as a toggle, which forces the load-bearing constraint: **position locators are structural and mode-independent** (spine item, element path, offset; never pixels), because bookmarks, progress, and highlight deep links must survive mode switches. LAN PWA from the owner's machine, no cloud backend; Logseq gets a thin highlights export.

## 2026-07-11 — Re-founding: owner as architect

The first build (M1 through M4) shipped working software but transferred no mental model to the owner. New model: the owner makes concept, contract, and stack decisions, recorded here in their voice; agents implement against them. Telos rewritten around product laws rather than feature lists; most former non-goals became pipeline ideas. A ground-up rewrite is planned as the ownership-transfer mechanism: the existing app stays alive as the reference implementation, and its lessons (the locator family, the shadow-DOM rendering traps, the demo-script-as-acceptance-test pattern) get a written salvage audit before new code starts.

## 2026-07-11 — Decision log over ADRs

Numbered ADRs with Status/Supersedes ceremony felt professionalized past the project's actual certainty. This file replaces them: dated entries, owner's voice, append-only. The record survives; the cosplay doesn't.

## 2026-07-11 — No MCP server

Agent access to the library is plain documented API endpoints plus a written query skill. Same capability as an MCP server, zero novelty budget on protocol plumbing. Revisit only if endpoints prove insufficient.

## 2026-07-12 — PWA, not native

The reader is a home-screen PWA on every device. EPUB content is HTML, so the browser engine is the rendering substrate no matter the shell; a native app would wrap a webview around the same code. Home-screen web apps support push notifications and stable storage on both major platforms, and native distribution on the phone carries a yearly fee for no rendering gain. Revisit only if platform support materially regresses.

## 2026-07-12 — Files over a database

The library is a folder. Each book is `book.epub` plus a `book.json` sidecar (state, progress, position, highlights; a JSONL beside it if highlights outgrow the sidecar), with `library.json` as the master index. Human-readable, portable, backed up by copying, syncable by any file tool. The search index is derived and disposable, rebuilt from the files. No database, no ORM.

## 2026-07-12 — No server: a synced folder is the backend

The library folder lives in the owner's cloud drive. The desktop mirrors it to disk, so import is dropping a file, reflow-to-epub deposits output directly, and agents read it as plain files. On phone and tablet the app talks to the drive API, keeps the current book and the on-deck queue fully local, and queues writes offline; latest timestamp wins on a sidecar. **Files are the contract, the drive is a transport**: the reader talks to a small storage interface, and the drive client is one implementation, swappable for a home server or a local folder without touching the reader. Setup uses an owner-created OAuth client with the file-scoped permission, published so tokens persist. The app itself is served once from a static HTTPS host and lives in the service worker cache after that.

## 2026-07-12 — Vanilla, zero runtime dependencies

Vanilla TS, HTML, CSS. No framework until it cannot be avoided; the reference implementation's UI debt was missing module boundaries, not a missing framework, and boundaries are the fix. Zero runtime dependencies in the shipped app; the drive client is confined to its transport module. Build tooling (bundler, tests) stays Bun and ships nothing.

## 2026-07-12 — Clean slate

With the architecture decided and the salvage audit written, the previous implementation and its tooling are deleted from `dev` (the tree at `d124d02` in git history is the last commit with the code). The rewrite starts from an empty codebase and bootstraps its own tooling; no backward compatibility with the old data layout.

## 2026-07-12 — Docs diet, and `dev` as the integration branch

Three docs total: `vision.md` (thesis, product laws, and a now/next/later section that absorbed the separate pipeline and roadmap files), `non-goals.md`, and this log. The orchestration diary, the handoff doc, and the milestone evidence captures were deleted; history lives in git, and the one pattern worth carrying (the demo/capture script *is* the acceptance test) moved into `.claude/CLAUDE.md`. Docs are written timeless: no version framing, no competitor naming; commit history is the historical record. Development targets `dev`; `main` stays the stable reference until the rewrite earns the merge. **The existing code stays until after the architecture decisions.** It is the reference implementation and the salvage audit's source; deleting it is a deliberate follow-up, not part of this reset.

## 2026-08-01 — Paginated by default, and scroll stays

Reading opens paginated. Scroll remains, as a toggle that lives with the rest of taste in the Aa panel. This overturns the 2026-07-03 entry, which put scroll first and pagination behind a toggle. The reason for the reversal is that the constraint that entry was protecting turned out to be the real deliverable: because positions are structural and mode-independent, the default costs nothing to change and neither mode is privileged in the data. Pages are what the boredom moment wants, and a page is a better unit than a scroll position for the reader's sense of place. The mode-invariance requirement is unchanged and is the load-bearing half; the default is the cheap half.

## 2026-08-01 — Rendering unit: one chapter at a time

The renderer lays out one spine item at a time. Continuous, book-wide rendering is refused for now. Why: every rendering trap already solved is solved against this model, and the two things that look like they need book-wide layout do not. The location index and progress derive from character counts, and print page numbers come from the EPUB page-list, so both are layout-free.

The casualty is Page Flip's thumbnail grid, which needs rendered pixels of pages the reader is not on. Page Flip instead gets a location slider across the whole book, chapter-skip arrows, and a live text excerpt at the slider position, none of which moves the reading position. This is a real loss of a Kindle affordance and is accepted deliberately. The peek UI does not bake the rendering unit into its shape, so a continuous renderer could upgrade it later without a redesign.

Chapter boundaries stay hard breaks, which is the known cost recorded in `salvage.md`. Revisit if the book map makes continuous layout worth its price.

## 2026-08-01 — The sidecar owns place, and how it merges

Bookmarks move into the synced `book.json` sidecar alongside position, progress, and highlights. Bookmarks living device-local was a v1 debt, and a bookmark that does not follow you is not a bookmark.

The sidecar now merges two ways and that needs stating rather than accreting. Scalar fields (position, progress, state) take the latest timestamp. Collections (highlights, bookmarks) merge by union of id, with per-item timestamps deciding a contested item. The consequence to accept knowingly: union means a delete loses to a stale copy, so deleting a bookmark on one device while another device holds an old sidecar resurrects it. Tombstones are the fix and are deliberately not built yet, because a resurrected bookmark is a small harm and tombstones are a permanent complication to the file format. Revisit if it happens in real use rather than in theory.

No third merge rule gets added without an entry here.

## 2026-08-01 — Taste is device-local, place is synced, and pace is taste

Typography, theme, and display mode are device-local and stay out of the sidecar. Position, progress, bookmarks, and highlights sync. A phone and a desktop want different type sizes and the same page.

Measured reading pace joins the device-local side. It is per device and per book, and it is an input to a comfort feature rather than a record of where you are. This extends the rule past typography, which is what the original framing covered, so it is written down rather than assumed.

## 2026-08-01 — Promoting the dictionary, footnote popovers, and time-left into the core

Offline dictionary lookup, footnote popovers, and pace-based time-left move from *Next* to *Now*. They were sequenced as believed-in-but-later, and building the core reading act made clear they are part of it rather than adjacent to it: all three are things a reader reaches for mid-page without leaving the page, which is exactly the friction the core is meant to remove. Wikipedia lookup stays in *Next*; it needs a network and the dictionary does not.

## 2026-08-01 — Tap zones are equal thirds

The forward tap zone is the right third, back is the left third, and the center third reveals chrome. The parity spec described a wider forward zone of roughly two thirds against a third for back, which is the Kindle geometry. Equal thirds wins because we kept the center tap for chrome, and a two-thirds forward zone leaves nowhere to put it. Where the spec and the code disagreed, the code was right and the spec row is corrected.

## 2026-08-01 — Bundled assets ship in the repo

Reading faces and the offline dictionary are committed to the repository and served from our own origin. No CDN, no fetch-on-first-run, no post-install step. Why: the product law is that reading never needs the network, and an asset that arrives over the network on first use is a feature that fails in exactly the moment it is for. Licenses ship in-tree next to the assets they cover.

The cost is real and accepted: several megabytes enter git history permanently and cannot be removed without a rewrite. The bound is that this applies to assets the reading act depends on. Anything optional or larger gets fetched and cached rather than committed, and lands here as its own entry first.

## 2026-08-01 — Literata is the application's face

The bundled reading face is also the chrome's face, across the library, the panels, and the dialogs, not only the book page. The app was previously set in the system stack. Why: it is the one bundled face that carries the oldstyle figures the interface uses, it is already precached so it costs nothing, and an e-reader whose furniture is set in the system UI font reads as a browser wrapped around a book. Books still default to the publisher's own choice; this is the application's typography, not the text's.

## 2026-08-01 — One acceptance suite, and CI runs all of it

Acceptance scenes live in one registered suite that CI runs on every pull request. The per-feature demo scripts that predate it are migrated into the suite or deleted, not left beside it. Why: two verification conventions with only one of them gated means the ungated half rots silently and its assertions become decoration, which is the failure mode the suite exists to prevent. An assertion nothing runs is worse than no assertion, because it reads as coverage.
