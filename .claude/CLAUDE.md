# CLAUDE.md — reader-42

You are working on **reader-42**, a local-first personal reading environment for long-form web and PDF content. This file is read at the start of every session in this repo. Read `docs/vision.md` and `docs/non-goals.md` before any substantive work, and `docs/diary.md` for patterns prior agents discovered.

## Project shape (one-line)

URL/PDF → headless-CC convert agent (per-item workspace + toolbox + verify-tool accountability) → EPUB → no-deps PWA reader → thin highlight export to PKM.

## Stack

- **Runtime:** Bun (1.3+)
- **Language:** TypeScript, strict mode (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- **Server:** Hono, listens on `:4242`
- **DB:** SQLite via better-sqlite3 + Drizzle ORM (schema is type source of truth)
- **Validation:** Zod at every boundary (HTTP, file ingest, convert-agent outputs)
- **Frontend:** vanilla TS/HTML/CSS — no framework, no EPUB-rendering library
- **Lint+format:** Biome
- **Pre-commit:** Lefthook (typecheck + lint, parallel)

ADRs live in `docs/decisions/`. Read them before changing anything load-bearing.

## Repo layout

```
apps/
  server/           # Hono API + convert orchestration (per-item CC subprocess)
  web/              # PWA reader + library UI (vanilla TS, no deps)
packages/           # shared types, db schema, contracts (created when first needed)
convert-workspace-template/   # template copied per-item for convert workspaces
data/               # NEVER COMMITTED — library.db, EPUBs, workspaces (gitignored)
docs/
  vision.md
  non-goals.md
  decisions/        # ADRs, dated and numbered NNNN-topic.md
  diary.md          # orchestration patterns — append-only, dated
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
- **Evidence pack:** PRs touching UI / reader / capture flow / conversion output / any user-visible behavior must attach a screenshot or short screen recording showing the change working. Build/refactor/docs/dependency PRs don't need this.
- Use the `pr-reviewer` subagent for self-review on substantive PRs.

## Definition of done

A feature is *done* when all of:

1. `bun run typecheck` clean
2. `bun run lint` clean
3. Behavioral tests cover the change (Bun test or Playwright as appropriate)
4. The agent ran the change end-to-end (server up, flow exercised) and captured an evidence artifact if scope warrants
5. PR description names what changed, why, and how it was verified
6. Branch follows naming convention; squash-merge target is `main`

**Don't mark a TaskList task `completed` until all six are true.**

## The two kinds of agents in this repo

There are two distinct agent contexts here. *Do not confuse them.*

1. **Repo-level dev agent (you, when invoked at this path)** — builds reader-42's server, reader, packages, docs. Reads this file. Writes TypeScript, opens PRs, etc.

2. **Convert agent (a separate `claude -p` invocation per library item)** — operates inside a per-item workspace under `data/workspaces/<item-id>/`. Reads its *own* `CLAUDE.md` from the workspace template, **not this file**. Job: convert one source (URL or PDF) into an EPUB + `report.json`. Restricted toolset, different conventions, deterministic verify gates.

When working on the convert system from this repo, you are editing the workspace *template* + the seed `tools/`, *not* writing code that runs as the agent. The convert agent's behavior is a function of the template's `CLAUDE.md`, skills, and toolbox — treat those as product code, not config.

## Operating model

- Plan with `TaskCreate`; mark `in_progress` when starting, `completed` when *all six* DoD criteria are true.
- Delegate self-contained chunks (build the reader, write the verify-tool stack, scaffold a server module) to subagents via the `Agent` tool with crisp, self-contained prompts.
- Reserve own context for: cross-cutting contracts, integration points, ADR entries, the pattern diary.
- Append to `docs/diary.md` when you discover a pattern worth remembering. Tight entries — patterns, not narratives. Dated.

## Quick references

| Want to | See |
|---|---|
| Understand the product | `docs/vision.md`, `docs/non-goals.md` |
| Understand a past decision | `docs/decisions/<NNNN>-<topic>.md` |
| See orchestration patterns | `docs/diary.md` |
| Self-review a PR | `.claude/agents/pr-reviewer.md` |
| Run the server | `bun run dev` (port 4242) |
| Typecheck | `bun run typecheck` |
| Lint+format | `bun run lint` / `bun run format` |
| Health check | `curl http://localhost:4242/health` |
