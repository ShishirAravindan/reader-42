# CLAUDE.md — reader-42

You are working on **reader-42**, a local-first personal Kindle clone: library, from-scratch EPUB reader, and highlights off-ramp to Logseq. This file is read at the start of every session in this repo. Read `docs/vision.md` and `docs/non-goals.md` before any substantive work, `docs/roadmap.md` for where we are, and `docs/diary.md` for patterns prior agents discovered.

## Project shape (one-line)

Finished EPUB (from [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub) or anywhere) → manual import → library → no-deps PWA reader (scroll + paginated, LAN-readable from tablets) → thin highlight export to Logseq.

Capture and conversion are **out of scope** — reflow-to-epub owns URL/PDF → EPUB entirely. There is no convert code here anymore (see `docs/decisions.md`, 2026-07-03).

## Stack

- **Runtime:** Bun (1.3+)
- **Language:** TypeScript, strict mode (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- **Server:** Hono, listens on `:4242`, serves the API and the web reader (LAN-reachable)
- **DB:** SQLite via better-sqlite3 + Drizzle ORM (schema is type source of truth); FTS5 for search
- **Validation:** Zod at every boundary (HTTP, EPUB import)
- **Frontend:** vanilla TS/HTML/CSS — no framework, no EPUB-rendering library
- **Lint+format:** Biome
- **Pre-commit:** Lefthook (typecheck + lint, parallel)

Decisions live in `docs/decisions.md` — a dated, append-only log in the owner's voice. Read it before changing anything load-bearing; new load-bearing choices get a new entry (made by the owner, not by agents). Load-bearing constraints: local-first, no deps in the core app, position locators are mode-independent.

## Repo layout

```
apps/
  server/           # Hono API + static serving of the reader
  web/              # PWA reader + library UI (vanilla TS, no deps)
packages/           # shared types, contracts (created when first needed)
data/               # NEVER COMMITTED — library.db, EPUBs (gitignored)
docs/
  vision.md
  non-goals.md
  pipeline.md       # ideas with a pulse — believed in, not now
  roadmap.md        # milestones + evidence-doc checkpoints
  decisions.md      # decision log — dated entries, append-only, owner's voice
  diary.md          # orchestration patterns — append-only, dated
  evidence/         # per-milestone screenshots/recordings for user review
.claude/
  CLAUDE.md         # this file
  agents/           # specialized subagent definitions
  skills/           # slash commands
```

## Branches & commits

- Branch prefixes: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`, `perf/`, `build/`. **Never `claude/<wacky>`.**
- Slug: 2-4 kebab-case words describing the change. `feat/highlight-export`, not `feat/stuff`.
- Conventional-commit messages, single-line preferred. **No `Co-Authored-By` trailer.**

## PR workflow

- One PR per feature, opened against `main`, squash-merged.
- PR title = the squash-commit message (conventional commit).
- PR body sections: **Summary** (bullets), **Test plan** (checklist).
- **Evidence pack:** PRs touching UI / reader / import flow / any user-visible behavior must attach a screenshot or short screen recording showing the change working (shot-scraper works well: `uvx shot-scraper <url>`). Build/refactor/docs/dependency PRs don't need this.
- Use the `pr-reviewer` subagent for self-review on substantive PRs.

## Milestone review model

The user reviews at **milestone granularity** (see `docs/roadmap.md`): each milestone ends with an evidence doc under `docs/evidence/<milestone>/` — shot-scraper captures of the real flows, open questions, next steps. Batch blocking decisions into structured questions up front (per milestone), then run autonomously; don't trickle questions mid-milestone unless genuinely blocked. Aesthetic decisions are made mockups-first: render real styled variants, capture them, let the user pick.

## Definition of done

A feature is *done* when all of:

1. `bun run typecheck` clean
2. `bun run lint` clean
3. Behavioral tests cover the change (Bun test or Playwright as appropriate)
4. The agent ran the change end-to-end (server up, flow exercised) and captured an evidence artifact if scope warrants
5. PR description names what changed, why, and how it was verified
6. Branch follows naming convention; squash-merge target is `main`

**Don't mark a TaskList task `completed` until all six are true.**

## Operating model

- Plan with `TaskCreate`; mark `in_progress` when starting, `completed` when *all six* DoD criteria are true.
- Delegate self-contained chunks to subagents via the `Agent` tool with crisp, self-contained prompts (see `docs/diary.md` for worktree/sandbox gotchas).
- Reserve own context for: cross-cutting contracts, integration points, decision-log upkeep, the pattern diary, evidence docs.
- Append to `docs/diary.md` when you discover a pattern worth remembering. Tight entries — patterns, not narratives. Dated.

## Quick references

| Want to | See |
|---|---|
| Understand the product | `docs/vision.md`, `docs/non-goals.md` |
| See milestones / current focus | `docs/roadmap.md` |
| Understand a past decision | `docs/decisions.md` |
| See orchestration patterns | `docs/diary.md` |
| Self-review a PR | `.claude/agents/pr-reviewer.md` |
| Run the server | `bun run dev` (port 4242) |
| Typecheck | `bun run typecheck` |
| Lint+format | `bun run lint` / `bun run format` |
| Health check | `curl http://localhost:4242/health` |
