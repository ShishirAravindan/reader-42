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

## 2026-05-09 — `isolation: "worktree"` doesn't auto-relocate the subagent's cwd

Even with `isolation: "worktree"` on the `Agent` invocation, the subagent's process inherits the parent's cwd at startup — the worktree exists on disk at `.claude/worktrees/agent-<id>/` but the subagent must explicitly `cd` there (or pass that absolute path to all file operations) to actually use it. Observed during the verify-toolbox spawn: the worktree was created and locked, but the subagent's writes landed in the main worktree, leaving their isolated worktree empty. Pattern: when prompting subagents for parallel work, give them the explicit absolute worktree path and instruct them to `cd` to it as step 0. Don't rely on the harness alone to relocate them. Worth folding into a reusable subagent-prompt preamble so every parallel spawn gets it.

## 2026-05-09 — Use `isolation: "worktree"` for parallel subagent work

Spawning a subagent for a contained chunk (the no-deps reader) while continuing different work (server skeleton) on a different branch requires `isolation: "worktree"` on the `Agent` invocation. Without it the subagent shares the orchestrator's cwd and writes WIP files directly into the working tree — you see their untracked files in your `git status`, their errors in your `bun run typecheck`/`lint`, and you risk staging their work into your PR. Pattern: any time you spawn an `Agent` in parallel that will branch+commit, set `isolation: "worktree"`. The orchestrator's PR scope stays clean; the subagent's branch is independent on disk. (See companion entry above on the cwd subtlety.)

## 2026-05-09 — PRs are a diff plus an evidence pack

For PRs whose scope changes user-visible behavior (UI, reader, capture flow, conversion output): attach a screenshot, short recording, or verified test transcript in the PR body. Build/refactor/docs/dependency PRs don't need it. The evidence pack is the user's review surface for asynchronous oversight; the implementing agent captures it before opening the PR, not as a checklist after. The `pr-reviewer` subagent enforces this by treating "missing evidence on a UI/feature PR" as `request-changes`.

## 2026-05-09 — Stop and diagnose after the first failure

When a tool times out or fails, *don't* retry the same operation in a sleep-then-retry loop. The user's directive: "diagnose the root cause." For browser-automation specifically: a `playwright-cli screenshot` timeout means the page is stuck (heavy load, click triggered something synchronous). Symptom-treating it with `sleep 5 && retry` wastes minutes and burns context for no signal. Pattern: first timeout → check state (snapshot, console log, server log). Don't retry without new information.

## 2026-05-09 — Background commands need explicit cleanup

`Bun.spawn` / `command &` background tasks survive the orchestrating bash invocation. Easy to leave servers running across a session, especially when something fails mid-flow. Pattern: track PIDs in `/tmp/<role>-pid.txt`, run `pkill -f <pattern>` before declaring a section done, and `ps aux | grep` periodically to catch zombies. The Bash tool's `run_in_background` parameter exists for a reason — using `&` in a one-shot command can leave behind unmanaged processes.

## 2026-05-09 — Subagent shells may be sandboxed differently than the orchestrator's

The `Agent` tool gives subagents a worktree, but their bash sandbox may block operations the orchestrator's bash allows. Both subagent runs in this session reported they couldn't run `bun install`, `git push`, `bun test`, or browser tooling. They could write code and commit but not verify or publish. Pattern: the orchestrator finishes the DoD steps the subagent couldn't. Don't assume the subagent can fully execute their PR cycle. Their report is "implementation done"; the orchestrator's job is "verify + push + screenshot + open PR."

## 2026-05-09 — Sandboxed worktrees can't always run `bun install`

A subagent working in `.claude/worktrees/<id>/` may have `bun install`, `bun run`, and headless browsers blocked by the harness sandbox while still permitting `bunx tsc` and `bunx biome` (those download a cached transpiler instead of touching the worktree's `node_modules`). Pattern: when typecheck fails on a server file the subagent didn't touch (e.g., `Cannot find module 'hono'`), suspect the worktree has no `node_modules/` rather than a real bug. The fix is at the orchestrator layer (loosen the sandbox, or hand the subagent a pre-installed worktree); the subagent's only honest move is to scope-verify what it can (`bunx tsc -p` on its own files, `bunx biome check` on its own dir) and document the env constraint in the evidence pack.

## 2026-05-09 — Resuming a rate-limited subagent's WIP starts with a careful read-pass

When picking up `wip:` snapshots from another subagent: read each file before changing anything; cross-check the WIP commit's parent against the current branch and against `main` (the WIP may pre-date later merges, leaving the branch missing context like a server skeleton); then run `bunx tsc -p` to triage real-bug errors from absent-`node_modules` errors. The temptation to rewrite from scratch is wrong — the prior agent's structure is usually fine; what's broken is mostly tsconfig, import-organization, formatting, and a couple of namespace-aware DOM lookups.

## 2026-07-03 — Re-scope means purge, in one change

When a concern is extracted to a sibling repo (convert → reflow-to-epub), the donor repo's identity docs rot silently: vision, ADRs, CLAUDE.md one-liners, DB states, and dead code all kept describing a product that no longer existed here. Pattern: re-scope is a single atomic change — docs *and* code *and* schema together, with an ADR (0005) superseding the outgoing ones — not a docs pass that leaves the code "for later." Also: batch every blocking product decision (ingest contract, reading model, devices, priorities, aesthetics, review cadence) into structured up-front questions before touching anything; eight answers up front bought the whole restructure without another interruption.
