# 0002 — Convert is a headless Claude Code agent, not a deterministic pipeline

Date: 2026-05-09
Status: Accepted

## Context

The conversion problem (URL/PDF → reading-ready EPUB) is genuinely diverse:

- Clean Substack post: extract → readability → minor cleanup → assemble
- Paywalled article: paywall handling → fetch → extract → cleanup
- Scanned 1970s book: better OCR → page reconstruction → ch detection → heavy cleanup
- 2-column academic PDF: column-aware extraction → structure → cleanup
- 12-part essay series: per-part extract → series-level metadata → dedup intros → bound TOC

A fixed pipeline with hardcoded prompts is human-engineered: works for the median input, fails on the long tail. Sutton's bitter lesson applies — methods that leverage compute and adaptive reasoning beat hand-engineered heuristics, especially across diverse inputs.

The previous iteration (`pdf2epub`) used a 4-stage pipeline (extract → structure → cleanup → assemble) with the *user* as the implicit verify stage via a side-by-side review UI. reader-42 makes that 5th stage a real automated step.

## Decision

Convert runs as a single headless Claude Code invocation per item:

- **Per-item workspace** (`./data/workspaces/<item-id>/`) with `source/`, `tools/`, `output/`, `CLAUDE.md`, `.claude/skills/`
- The workspace `CLAUDE.md` is the agent's spec: stages (extract, structure, cleanup, verify, assemble), required output schema (`output/book.epub` + `output/report.json`), verify gates that must pass, done definition
- The agent has a **toolbox** of stable scripts (verify checks, extractors, assemblers) it calls but cannot redefine
- The agent emits a `report.json` with structured findings; verify gates are deterministic, the agent's freedom is in *path selection* through the toolbox
- **Budget**: `--max-turns N` + wall-clock + token cap; on exceed → workspace preserved, item enters `paused` state, resumable later (warm `--resume` if available, cold-start from workspace state otherwise)
- **Single invocation per item** (one logical agent run, may span multiple OS-level invocations across resumes)
- **Self-modifying toolbox**: agent can write/install new tools mid-run; useful additions get promoted into the seed `tools/` dir of the repo via a curation loop (agent writes a `tool_proposal.md`; user batch-reviews and promotes)

## Rationale

- Adaptive to source quality (more compute on hard inputs, less on easy ones)
- Best tool per job rather than fixed prompt (Marker, Nougat, Calibre recipes, trafilatura, Playwright, etc.)
- Self-iterating ("structure looks weird, let me re-extract differently")
- The audit trail (`report.json`) is the calibrated-confidence feature — what makes "the system tells you what it's unsure about" real
- Free for us via Claude Code: Bash/Read/Write/Edit, MCP, hooks, slash commands, skills, streaming output, session resume
- Pro plan covers usage; centralized billing
- Bitter-lesson aligned: invest in the agent's reasoning + tool diversity, not in clever per-prompt engineering

## Consequences

- Convert layer becomes coupled to Claude Code as a runtime dependency. Acceptable for personal use.
- Reproducibility is partial — same input may take different paths, but verify contracts ensure same pass/warn/fail outcome on the same EPUB
- Pro rate limits will occasionally bite on hard items; surface token spend on the library card; resume support keeps it humane
- The workspace `CLAUDE.md` + skills + `report.json` schema become **the load-bearing artifact** for convert quality — treat them as product code
- Verify tools must be deterministic and stable: the agent calls them but does not get to redefine what passing means
