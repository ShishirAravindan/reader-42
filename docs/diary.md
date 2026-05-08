# Orchestration diary

Patterns discovered while orchestrating reader-42's implementation. Tight entries — patterns, not narratives. Append-only, dated.

## 2026-05-09 — Memory carries forward, but only by replication

The auto-memory system is keyed by absolute project path. Moving from `pdf2epub/` to `reader-42/` means the new project's memory dir starts empty. Replicate relevant feedback memories (commit style, branch naming, planning pacing, operating model) into the new path on bootstrap, otherwise future sessions in `reader-42/` lose context the user already paid to establish.

## 2026-05-09 — Git/storage/commit/PR strategy is the user's review surface

The user explicitly flagged these as their continued involvement points after handing off implementation. They aren't just bikeshed preferences — they're how the user audits an autonomous build asynchronously. Honor them, document them in decisions/, don't drift mid-stream. Branch names, commit prefixes, PR shape are the artifact future-you reads to understand what happened.

## 2026-05-09 — Convert is product code, not glue

The convert workspace `CLAUDE.md` + skills + `report.json` schema is the load-bearing artifact for conversion quality. Treat it like product code, not a config file: review it carefully, version it, write decisions about its shape. The agent's behavior is a function of this artifact more than of any single prompt.

## 2026-05-09 — Dev tooling can self-install on `bun install`

Lefthook auto-installs its git hooks via its own package postinstall script. "Defer the decision until later" by skipping the explicit `lefthook install` doesn't actually defer if `bun install` already ran with lefthook in `devDependencies`. Pattern: when the user wants to defer a setup step, also defer adding the package; or explicitly note the postinstall side-effect. Don't assume the lever you reached for is the only one wired up.

## 2026-05-09 — PRs are a diff plus an evidence pack

For PRs whose scope changes user-visible behavior (UI, reader, capture flow, conversion output): attach a screenshot, short recording, or verified test transcript in the PR body. Build/refactor/docs/dependency PRs don't need it. The evidence pack is the user's review surface for asynchronous oversight; the implementing agent captures it before opening the PR, not as a checklist after. The `pr-reviewer` subagent enforces this by treating "missing evidence on a UI/feature PR" as `request-changes`.

## 2026-05-09 — Sandboxed worktrees can't always run `bun install`

A subagent working in `.claude/worktrees/<id>/` may have `bun install`, `bun run`, and headless browsers blocked by the harness sandbox while still permitting `bunx tsc` and `bunx biome` (those download a cached transpiler instead of touching the worktree's `node_modules`). Pattern: when typecheck fails on a server file the subagent didn't touch (e.g., `Cannot find module 'hono'`), suspect the worktree has no `node_modules/` rather than a real bug. The fix is at the orchestrator layer (loosen the sandbox, or hand the subagent a pre-installed worktree); the subagent's only honest move is to scope-verify what it can (`bunx tsc -p` on its own files, `bunx biome check` on its own dir) and document the env constraint in the evidence pack.

## 2026-05-09 — Resuming a rate-limited subagent's WIP starts with a careful read-pass

When picking up `wip:` snapshots from another subagent: read each file before changing anything; cross-check the WIP commit's parent against the current branch and against `main` (the WIP may pre-date later merges, leaving the branch missing context like a server skeleton); then run `bunx tsc -p` to triage real-bug errors from absent-`node_modules` errors. The temptation to rewrite from scratch is wrong — the prior agent's structure is usually fine; what's broken is mostly tsconfig, import-organization, formatting, and a couple of namespace-aware DOM lookups.
