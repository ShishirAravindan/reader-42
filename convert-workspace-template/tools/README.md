# Seed toolbox

Stable scripts the convert agent calls but does **not** redefine. The agent's freedom is in *path selection* through these tools, not in deciding what counts as correct.

Tools listed in `CLAUDE.md` § The toolbox. Each tool emits structured JSON when run with `--json` (machine-readable) or human output without (interactive).

## Tools (build status)

| Tool | Status | Notes |
|---|---|---|
| `drift-check` | ready | Multi-signal drift detection: length ratio, n-gram coverage (raw→cleaned and cleaned→raw), structural preservation (HTML hrefs/srcs/headings), and an LLM-judge stub. Inputs: `--raw`, `--cleaned`, `--mode=html\|text`, `--json`. |
| `verify-extract` | ready | Extract-stage sanity check. Inputs: `--source-type=url\|pdf`, `--raw`, `--json`. |
| `verify-structure` | ready | Structure-stage sanity check on `structure.json`. Inputs: `--structure`, `--json`. |
| `run-epubcheck` | ready | epubcheck CLI wrapper. Positional `<path-to-epub>`, `--json`. Skipped (not failed) if epubcheck not on PATH. |
| `fetch-url` | pending | Fetch with sensible UA + Playwright fallback |
| `extract-pdf` | pending | PDF text + image extraction (poppler) |

The four verify tools are the deterministic accountability layer that earns the "no manual editing" bar. Run them between stages. Each emits a `{ status, findings, ... }` JSON object when passed `--json`; non-`--json` mode prints a short human summary. Findings follow the shape in `report.schema.json`.

The `drift-check` LLM-judge sub-check is a v1 stub — it returns `{ status: "skipped" }` and documents what would be invoked in a future iteration. Real LLM calls land in a later wiring pass.

## Adding a tool

Each tool is a single executable script (Bun TS, shell, or Python — language fits the job). It must:

1. Accept input via positional args or stdin
2. Emit structured JSON to stdout when called with `--json`
3. Exit 0 on pass, non-zero on hard fail
4. Document its input/output in a header comment
