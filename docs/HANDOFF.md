# Handoff — current state and the next move

> Living doc. A future session reads this *after* `.claude/CLAUDE.md` to learn what's been built and what to pick up.

## State as of 2026-05-09

**All foundations are in. The vertical slice is the next move.**

Six PRs merged, 7 tasks complete, 1 remaining. The repo can be installed (`bun install`), typechecks clean, lints clean, has 25 passing tests for the verify toolbox, and the reader serves a real EPUB end-to-end.

### What's built

| Layer | Status | Where |
|---|---|---|
| Vision + non-goals + ADRs (4) | ✅ | `docs/vision.md`, `docs/non-goals.md`, `docs/decisions/000{1-4}-*.md` |
| Repo agent context (CLAUDE.md, pr-reviewer) | ✅ | `.claude/CLAUDE.md`, `.claude/agents/pr-reviewer.md` |
| TS + Bun + Hono + Drizzle + Biome foundation | ✅ | `package.json`, `apps/server/`, `apps/web/`, `tsconfig.json`, `biome.json` |
| Server skeleton — items table, capture/library/reader routes | ✅ | `apps/server/src/{routes,db,convert}/` |
| Convert worker — real `claude -p` spawn per item | ✅ | `apps/server/src/convert/worker.ts` |
| Convert workspace template — agent spec + report schema | ✅ | `convert-workspace-template/` |
| Verify toolbox — drift-check + epubcheck + extract/structure sanity | ✅ | `convert-workspace-template/tools/` |
| EPUB reader (no deps) — parser, renderer, fixture, dev server | ✅ | `apps/web/` |
| **End-to-end vertical slice** — paste URL → convert → read | ⏳ | *next* |

### What still needs wiring

The pieces exist but aren't yet glued into a walking skeleton. The vertical slice is:

1. UI for capture: paste-URL box (talks to `POST /capture/url`)
2. Library list view: lists items with state badges (uses `GET /library`)
3. Library item, when state=ready, opens in the reader (loads from `GET /reader/:id/epub`)
4. Reader served by the server (currently only `apps/web/server.ts` standalone — needs to be served by `apps/server` or proxied)
5. Real end-to-end test: paste a real article URL → convert agent runs → EPUB lands → reader displays it
6. Conversion notes UI (v1 floor): clean / has-notes / paused / quarantined badges on the library card; item-detail page reads `report.json` and lists findings with `human_message` text

This is task #9. Recommended branch: `feat/vertical-slice`.

## How to pick up

```bash
cd /Users/shishiraravindan/Documents/coding/reader-42
bun install
bun run typecheck
bun test convert-workspace-template/tools/    # 25 tests, all pass
git checkout -b feat/vertical-slice
```

Then read in this order:

1. `.claude/CLAUDE.md` — repo rules, branching, DoD, evidence-pack rule
2. `docs/vision.md` + `docs/non-goals.md` — what this is and isn't
3. `docs/decisions/0002-convert-as-agent.md` — why convert is a CC subprocess
4. `docs/decisions/0004-convert-workspace-shape.md` — manifest + report contracts
5. `convert-workspace-template/CLAUDE.md` — the convert agent's spec (it reads this, not the repo CLAUDE.md)
6. `docs/diary.md` — orchestration patterns and gotchas

## Known gotchas (read before working)

- **Subagent worktree isolation** — `Agent({ isolation: "worktree" })` creates a worktree at `.claude/worktrees/agent-<id>/` but does **not** auto-relocate the subagent's cwd. Tell the subagent in their prompt to `cd` to the absolute worktree path as step 0, or they'll write into the orchestrator's worktree.
- **Subagent shells may be sandboxed differently than yours** — they can compile and commit but may not be able to push, run servers, or invoke browsers. The orchestrator finishes the DoD steps the subagent couldn't.
- **Lefthook auto-installs on `bun install`** — typecheck + lint pre-commit hook is on. Lint scope is `{staged_files}`; typecheck is project-wide (relies on `tsconfig.json`'s `include`).
- **The `data/` directory is gitignored** — library DB, EPUBs, and per-item workspaces all live there. Never commit it. Same for `.claude/worktrees/`.
- **Convert worker spawns real `claude -p`** — running `POST /capture/url` end-to-end will spend money on the user's CC subscription. Use a budget guard (`CONVERT_MAX_BUDGET_USD` env, defaults to $2) and a wall-clock timeout (`CONVERT_WALL_CLOCK_MS`, default 30 min). The worker writes to `data/workspaces/<id>/` and copies the resulting EPUB to `data/epubs/<id>.epub`.

## What the user cares about

(From conversation, encoded into memory; reiterating the load-bearing pieces.)

- **Calibrated confidence is a user-facing feature, not just a dev gate.** Every `warn`/`fail` finding the convert agent emits has a `human_message` — calm, plain, useful. The library card and item-detail page surface these. The schema enforces this (`report.schema.json` requires `human_message`, `minLength: 1`).
- **The library is a record, not an inbox.** Friction in capture is *the feature*. No share sheets. No browser extension. Paste-URL box + drop folder, that's it.
- **Highlights are an exit ramp to PKM.** Logseq does the graph; reader-42 is the durable archive. Highlight export is deferred from v1 but the data model should accommodate it.
- **The reader is table-stakes; convert is the value-add.** Most engineering effort goes into convert quality. Reader stays minimal and no-deps.
- **Branch names use conventional prefixes**: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`. *Never* `claude/<wacky-words>`.
- **PRs touching user-visible behavior need an evidence pack** — screenshot via the playwright-cli skill, or recording, or transcript if browser capture isn't feasible.
- **Use the playwright-cli skill** for any browser automation. Install with `playwright-cli install --skills` if not present locally.
- **Conventional commits, single-line preferred, no `Co-Authored-By` trailer ever.**

## What I'd do next, concretely

A vertical slice that earns the name. In order:

1. **Library + capture UI** — extend `apps/web/index.html` with a left-pane library list and a top-pane paste-URL input. Talks to existing API. (~1 PR)
2. **Wire `apps/server` to serve `apps/web`** — Hono static-file route. Optional: bundle web via `bun build` or serve TS-compiled-on-the-fly like the standalone web server does. (~1 PR or folded into the above)
3. **Real conversion** — capture a known-good URL (e.g. a Paul Graham essay), let the agent run, land the EPUB. Capture the convert workspace + report.json as an artifact. This is the calibrated-confidence promise becoming real. (~1 PR with a real conversion run as evidence)
4. **Conversion-notes UI on library card + item detail** — read `report.json` from the API, display findings. (~1 PR)

After that, the product is dogfoodable for the user's daily 30-min reading ritual.
