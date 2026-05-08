# 0004 — Convert workspace shape and server integration

Date: 2026-05-09
Status: Accepted

## Context

ADR 0002 established that convert runs as a single headless Claude Code invocation per item, in a per-item workspace. This ADR pins down the workspace shape: layout, manifest contract, output contract, and how the server interacts with it.

## Decision

### Workspace template lives at `convert-workspace-template/` in the repo

It is **product code**, not config. Treated like any other code: reviewed, versioned, ADR'd when it changes shape. The agent's behavior is a function of `CLAUDE.md` + skills + toolbox + report schema; that's the spec.

### Per-item workspace lifecycle

```
1. server.capture()               → DB row created, state=captured
2. server.enqueueConvert(itemId)  → cp -r convert-workspace-template/ data/workspaces/<itemId>/
                                     write manifest.json
                                     drop source content into source/ (PDFs only; URL fetched by agent)
3. server spawns claude -p in workspace with --max-turns + wall-clock timeout
4. agent runs stages, writes output/book.epub + output/report.json
5a. on exit 0:    copy book.epub → data/epubs/<itemId>.epub
                  parse report.json into DB; state=ready
                  workspace kept for forensics; cleaned up after N days
5b. on exit !=0:  parse partial report.json if present
                  state=paused (budget) | quarantined (verify failed)
                  workspace preserved indefinitely for resume
```

### Manifest schema (server → agent)

```json
{
  "item_id": "abc123",
  "source_type": "url" | "pdf" | "url_series",
  "source_ref": "<url or path>",
  "urls": ["..."]   // url_series only
}
```

### Report schema (agent → server)

`convert-workspace-template/report.schema.json`. Required: stages (with per-stage status), findings (with `human_message`), tokens_used, wall_clock_ms.

### Findings discipline

Pass-level results are silent. Only `warn` and `fail` produce findings. Every finding has a `human_message` — calm, plain, useful, written for the user. This is the calibrated-confidence promise made real.

### Toolbox is stable; agent gets path-selection freedom

Seed tools live at `convert-workspace-template/tools/`. The agent **calls** them but cannot redefine what passing means. The agent may add task-local helpers into the per-item workspace's `tools/`. Useful additions get promoted into the seed via a `tool_proposal.md` curation loop.

### Resume model

Workspace state is the durable resume substrate (not just CC `--resume`). Stage outputs (`extracted/`, `structure.json`, `cleaned/`, `output/book.epub`) are completion markers. A resumed agent reads what's on disk and continues. CC `--resume` is a nice-to-have on top.

## Rationale

- Workspace-as-code keeps the agent's spec in version control where it belongs
- Per-item workspaces give clean isolation, trivial debugging (`ls data/workspaces/<id>/` shows everything), and natural durability for resume
- The findings/human_message discipline forces the calibrated-confidence promise to be honored at the contract level — agents can't skip it
- Toolbox stability keeps verify gates trustworthy across runs even as the agent's path-selection evolves

## Consequences

- The template **must** be kept under repo version control even though `data/workspaces/` is gitignored
- Server `enqueueConvert` becomes a copy + spawn + post-process function — not just stub it; ADR 0002's "stub for now" lifts here
- Tool proposals become a real curation loop; we'll need a lightweight workflow (probably batch-review script + diary entries) once we have multiple proposals
- Cleanup policy for old workspaces is deferred — initial v1 keeps everything; revisit when disk usage is real
