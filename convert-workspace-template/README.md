# Convert workspace template

Template copied per-item to `data/workspaces/<item-id>/` when the server enqueues a conversion. The convert agent runs inside the copied workspace.

## Why this is product code

The agent's behavior is a function of `CLAUDE.md` + skills + the toolbox + the report schema. These artifacts *are* the convert pipeline. Treat them like product code:

- Review changes carefully
- ADR significant shape changes (`docs/decisions/000N-*.md`)
- Run end-to-end conversions when changing CLAUDE.md or schema

## Layout

```
CLAUDE.md            # the agent's spec — read on start
report.schema.json   # contract for output/report.json
manifest.json        # written by the server before invocation; the job description
source/              # raw source content (server drops it here)
extracted/           # stage 1 artifacts
cleaned/             # stage 3 artifacts
output/              # FINAL: book.epub + report.json
tools/               # seed toolbox — agent calls these, doesn't redefine
.claude/skills/      # optional skills the agent can invoke as named subroutines
```

## Server integration

The server worker (`apps/server/src/convert/worker.ts`):

1. Copies this template to `data/workspaces/<item-id>/`
2. Writes `manifest.json` with item_id, source_type, source_ref
3. Drops source content into `source/` (URL: nothing — the agent fetches; PDF: copies the file in)
4. Spawns `claude -p` in the workspace with `--max-turns N` and a wall-clock timeout
5. On success: copies `output/book.epub` to `data/epubs/<item-id>.epub`, parses `output/report.json` into the library DB
6. On non-zero exit: marks item `paused` (resumable) or `quarantined` (verify failed)

## Updating the seed toolbox

When the agent writes a `tool_proposal.md` in a workspace and the orchestrator decides it's broadly useful, the proposed tool gets promoted into `convert-workspace-template/tools/` here. That's the curation loop that prevents toolbox rot.
