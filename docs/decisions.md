# Decisions

Dated, append-only log of the decisions that shape reader-42. A few sentences each; changing course costs a new entry, not a supersession chain. Compressed from the v1 ADRs (`docs/decisions/`, deleted 2026-07-11 — full text in git history).

## 2026-05-09 — Stack: TypeScript end-to-end

Bun + Hono server, SQLite via better-sqlite3 + Drizzle (schema is the type source of truth), Zod at every boundary, vanilla TS/HTML/CSS frontend, Biome for lint/format. Why: one language means one agent context and one toolchain; SQLite is right-sized for single-user and brings FTS5 for free; `bun build` keeps single-binary distribution open.

## 2026-05-09 — Reader built from scratch, no EPUB-rendering dependencies

No epub.js/foliate-js/react-reader. Parse the zip + OPF + spine ourselves, render chapter HTML in a sandboxed viewport. Why: the reader is the product — full control over typography and locators, no dependency rot, small fast PWA; coding agents make from-scratch tractable. Cost accepted: we own the EPUB edge cases and must degrade gracefully on wild EPUBs.

## 2026-05-09 — Conversion as a headless agent *(dead end, extracted)*

URL/PDF → EPUB was designed as a headless Claude Code agent in per-item workspaces with a stable verify toolbox. The whole concern was extracted to [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub), which re-derived its own design; the code here was deleted without ever running on real documents. Lesson kept: carry lessons, not code.

## 2026-07-03 — Re-scope: library + reader + highlights off-ramp

Nothing upstream of a finished EPUB is in scope. Manual UI import only (friction-as-gate). Item lifecycle `unread → reading → finished | dnf`, metadata from the OPF. Scroll mode first, pagination as a toggle — which forces the load-bearing constraint: **position locators are structural and mode-independent** (spine item + element path + offset, never pixels), because bookmarks, progress, and highlight deep links must survive mode switches. LAN PWA from the owner's Mac, no cloud backend; Logseq gets a thin highlights export.

## 2026-07-11 — v2 re-founding: owner as architect

v1 (M1–M4) shipped working software but transferred no mental model to the owner. New model: the owner makes concept/contract/stack decisions (recorded here, in their voice); agents implement against them. Telos rewritten (`vision.md` v2 — product laws over feature lists; most non-goals became `pipeline.md` entries). A ground-up rewrite is planned as the ownership-transfer mechanism: v1 stays alive as the reference implementation, and its lessons (locator family, shadow-DOM rendering traps, demo-script-as-acceptance-test) get a written salvage audit before v2 code starts.

## 2026-07-11 — Decision log over ADRs

Numbered ADRs with Status/Supersedes ceremony felt professionalized past the project's actual certainty. This file replaces them: dated entries, owner's voice, append-only. The record survives; the cosplay doesn't.

## 2026-07-11 — No MCP server

Agent access to the library is plain documented API endpoints plus a written query skill. Same capability as an MCP server, zero novelty budget on protocol plumbing. Revisit only if endpoints prove insufficient.

## 2026-07-12 — Docs diet, and `dev` as the integration branch

Three docs total: `vision.md` (thesis, product laws, and a now/next/later section that absorbed the separate pipeline and roadmap files), `non-goals.md`, and this log. `diary.md` and `HANDOFF.md` deleted — v1 orchestration lore lives in git history; the one pattern worth carrying (the demo/capture script *is* the acceptance test) moved into `.claude/CLAUDE.md`. Development now targets a `dev` branch; `main` stays the stable v1 reference until v2 earns the merge.
