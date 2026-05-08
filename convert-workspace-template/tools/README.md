# Seed toolbox

Stable scripts the convert agent calls but does **not** redefine. The agent's freedom is in *path selection* through these tools, not in deciding what counts as correct.

Tools listed in `CLAUDE.md` § The toolbox. Each tool emits structured JSON when run with `--json` (machine-readable) or human output without (interactive).

## Tools (build status)

| Tool | Status | Notes |
|---|---|---|
| `drift-check` | pending | Multi-signal drift detection. See task #6 in the project roadmap. |
| `verify-extract` | pending | Extract-stage sanity check |
| `verify-structure` | pending | Structure-stage sanity check |
| `run-epubcheck` | pending | epubcheck CLI wrapper |
| `fetch-url` | pending | Fetch with sensible UA + Playwright fallback |
| `extract-pdf` | pending | PDF text + image extraction (poppler) |

These get filled out in the next workstream (verify-tool toolbox). For now this template ships with the spec; tools come online incrementally.

## Adding a tool

Each tool is a single executable script (Bun TS, shell, or Python — language fits the job). It must:

1. Accept input via positional args or stdin
2. Emit structured JSON to stdout when called with `--json`
3. Exit 0 on pass, non-zero on hard fail
4. Document its input/output in a header comment
