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

## 2026-07-12 — Docs diet, and `dev` as the integration branch

Three docs total: `vision.md` (thesis, product laws, and a now/next/later section that absorbed the separate pipeline and roadmap files), `non-goals.md`, and this log. The orchestration diary, the handoff doc, and the milestone evidence captures were deleted; history lives in git, and the one pattern worth carrying (the demo/capture script *is* the acceptance test) moved into `.claude/CLAUDE.md`. Docs are written timeless: no version framing, no competitor naming; commit history is the historical record. Development targets `dev`; `main` stays the stable reference until the rewrite earns the merge. **The existing code stays until after the architecture decisions.** It is the reference implementation and the salvage audit's source; deleting it is a deliberate follow-up, not part of this reset.
