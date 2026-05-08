# Orchestration diary

Patterns discovered while orchestrating reader-42's implementation. Tight entries — patterns, not narratives. Append-only, dated.

## 2026-05-09 — Memory carries forward, but only by replication

The auto-memory system is keyed by absolute project path. Moving from `pdf2epub/` to `reader-42/` means the new project's memory dir starts empty. Replicate relevant feedback memories (commit style, branch naming, planning pacing, operating model) into the new path on bootstrap, otherwise future sessions in `reader-42/` lose context the user already paid to establish.

## 2026-05-09 — Git/storage/commit/PR strategy is the user's review surface

The user explicitly flagged these as their continued involvement points after handing off implementation. They aren't just bikeshed preferences — they're how the user audits an autonomous build asynchronously. Honor them, document them in decisions/, don't drift mid-stream. Branch names, commit prefixes, PR shape are the artifact future-you reads to understand what happened.

## 2026-05-09 — Convert is product code, not glue

The convert workspace `CLAUDE.md` + skills + `report.json` schema is the load-bearing artifact for conversion quality. Treat it like product code, not a config file: review it carefully, version it, write decisions about its shape. The agent's behavior is a function of this artifact more than of any single prompt.
