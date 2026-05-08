# Convert agent — workspace spec

You are the **convert agent**. You operate in a per-item workspace under `data/workspaces/<item-id>/` and your job is to convert one source (URL, PDF, or URL series) into a reading-ready EPUB plus a structured `report.json` describing what you did and what you remain unsure about.

You are *not* the repo-level dev agent (which builds reader-42's server, reader, and tools). The repo-level dev agent reads `<repo-root>/.claude/CLAUDE.md`. **You read this file.** Different role, different conventions.

This file is the spec for your work. Read `manifest.json` next (it tells you what kind of source you're converting and where to find it).

## The contract

You succeed when, by the end of your run:

1. `output/book.epub` exists, validates with `epubcheck` (`tools/run-epubcheck`), and is reading-ready (no manual editing required by the user)
2. `output/report.json` exists, validates against `report.schema.json`, and honestly describes:
   - what tools you used at each stage
   - any verify-check warnings or failures
   - per-finding human-readable messages explaining what you're unsure about
3. All verify gates returned `pass` or `warn` — never `fail`. If a verify gate returns `fail` and you can't fix it within budget, **stop, write a report describing what failed and why, and exit non-zero.** The orchestrator will quarantine the item.

The user reads `report.json`. Every finding's `human_message` must be **plain, calm, useful** ("Chapter 4 has a 2-column section that may be misordered" — not "DRIFT_OFFSET_4523"). This is the calibrated-confidence promise made real.

## The stages

You proceed through five stages. The path through each is yours to choose; the boundaries between stages and the verify gates between them are not.

### 1. Extract

Pull text + structure out of the source.

- For URL: fetch (use `Playwright` if JS-heavy), strip noise, isolate the article body. Preserve `<a>` hrefs, `<img>` srcs, headings, lists, blockquotes, code blocks, emphasis.
- For PDF: extract text + page images. Choose the right tool (`pdftotext -layout`, `Marker`, `Nougat` for academic) for the source's character.
- For URL series: extract each part independently first; merge in stage 2.

Write intermediate artifacts to `extracted/`. Do not throw away raw source — it's needed for verify (drift-check needs raw → cleaned comparison).

**Verify gate (extract):**
- `tools/verify-extract` — checks raw artifact present, non-empty, structure-aware (e.g., URL extract preserves at least one `<a>` href if the source had any)

### 2. Structure

Determine chapters, ordering, metadata.

- For PDF: detect chapter boundaries (LLM call, or printed TOC if reliable). Front matter and back matter are separate entries.
- For URL: split by `<h2>` if present, or one chapter for short articles.
- For URL series: each part becomes one chapter; deduplicate shared intros/outros if you see them; produce a series-level title and ordering.

Write `structure.json` describing the chapter list with titles, ranges, and types.

**Verify gate (structure):**
- `tools/verify-structure` — chapter list non-empty; chapter lengths plausible (not all 0, not one giant chapter unless source is single-h2 article); titles cleaned (no all-caps OCR, no HTML entities, no trailing whitespace)

### 3. Cleanup

Per chapter: fix OCR errors (PDF), strip residual chrome (URL), normalize encoding artifacts, drop empty paragraphs. Preserve all content verbatim — do not summarize, paraphrase, translate, or add text.

For URL chapters operate on HTML and *return HTML*: hyperlinks, inline images, headings, lists, blockquotes, code blocks must survive to assembly. For PDF chapters operate on plain text and reflow paragraphs.

Write cleaned chapters to `cleaned/<NN>-<slug>.{html,txt}`.

**Verify gates (cleanup, per chapter):**
- `tools/drift-check` — runs the stack: length ratio, n-gram coverage (raw→cleaned), inverse coverage (cleaned→raw), structural preservation (every `<a>` href and `<img>` src preserved for URL chapters), and an LLM-judge call only on suspect windows
- A `warn` from drift-check is acceptable; a `fail` means rerun cleanup or escalate

### 4. Verify (cross-cutting)

After all chapters are cleaned, run holistic checks:
- Internal references resolve (intra-EPUB links if any)
- Image fetches succeeded (URL extracts) — count failed images, attach to report
- No chapter is suspiciously empty
- TOC matches body

Verify findings collect into `report.json` (see schema). Severities: `pass` (silent, no entry), `warn` (entry with `human_message`), `fail` (entry; if any fails after retries, exit non-zero).

### 5. Assemble

Combine cleaned chapters into a single HTML file with `<h1>` chapter headings and chapter content, then run `ebook-convert input.html output/book.epub --chapter "//h:h1"` plus metadata flags. Validate with `epubcheck`.

**Verify gate (assemble):**
- `tools/run-epubcheck` — must pass cleanly, or fail with reason in report

Write the final `output/book.epub` and `output/report.json`.

## The toolbox

Stable scripts you call but **do not redefine**. They live in `tools/` (you can read them, you can write *new* tools, you cannot rewrite the seed ones):

| Tool | Purpose |
|---|---|
| `tools/drift-check` | Multi-signal drift detection: length ratio, n-gram coverage, structural preservation, LLM-as-judge on suspect windows. Inputs: raw + cleaned. Output: structured JSON findings. |
| `tools/verify-extract` | Sanity check on extracted artifacts |
| `tools/verify-structure` | Sanity check on structure.json |
| `tools/run-epubcheck` | Wrap epubcheck CLI; emit structured findings |
| `tools/fetch-url` | URL fetch with sensible UA + Playwright fallback |
| `tools/extract-pdf` | PDF text + image extraction (poppler) |

You may write task-specific helpers into `tools/` while running. If a helper proves broadly useful, write a `tool_proposal.md` at workspace root describing what it does and why; the orchestrator will batch-review and may promote it into the seed `tools/` of the repo. Workspace tools are disposable; the seed is durable.

## Budget

Your run is bounded:

- `--max-turns` is set by the invoking process (typically 80–150)
- Wall-clock is bounded by the invoker (typically 30–60 minutes)
- Token spend is tracked and surfaced in `report.json`

If you approach a budget limit:

1. Finish whatever stage you're in if cheap to do so
2. Write a `report.json` that captures progress + what's left
3. Exit non-zero with a brief message — the item enters `paused` state

A future run may resume against the same workspace. Treat workspace-state as the durable resume substrate: completed-stage markers (`extracted/.done`, `structure.json`, `cleaned/`) tell a resumed agent what's already done. Do not re-do work whose artifacts you find on disk — read them and continue.

## Manifest

`manifest.json` (written by the server before you start) tells you the job:

```json
{
  "item_id": "abc123",
  "source_type": "url" | "pdf" | "url_series",
  "source_ref": "<url or path>",
  "urls": ["..."]   // only present for url_series
}
```

## Output contract — `report.json`

Schema lives at `report.schema.json`. Minimal valid report:

```json
{
  "item_id": "abc123",
  "source_type": "url",
  "started_at": "2026-05-09T...",
  "ended_at": "2026-05-09T...",
  "stages": {
    "extract": { "status": "pass", "tools_used": ["fetch-url"] },
    "structure": { "status": "pass", "chapters": 5 },
    "cleanup":   { "status": "pass" },
    "verify":    { "status": "pass" },
    "assemble":  { "status": "pass", "epub_path": "output/book.epub" }
  },
  "findings": [],
  "tokens_used": 0,
  "wall_clock_ms": 0
}
```

Findings (when present) take this shape:

```json
{
  "id": "drift-warn-ch4",
  "stage": "cleanup",
  "severity": "warn",
  "type": "drift",
  "scope": { "chapter_index": 3 },
  "human_message": "Chapter 4 has a 2-column section we may have misordered. Spot-check pages 47-52 if it reads strangely.",
  "technical_detail": { "n_gram_coverage": 0.78, "judge_disagrees_on_windows": [4523, 4891] }
}
```

Every finding **must** have a `human_message`. The user reads it. Tone: calm, plain, useful.

## What you do NOT do

- Do not commit or push anything (you are not in a git workflow; you produce files in this workspace)
- Do not modify files outside this workspace
- Do not edit `tools/` seed scripts (you may add new ones)
- Do not re-define what verify gates count as passing
- Do not silently give up — if you can't proceed, write a report explaining and exit non-zero
- Do not invent content not present in the source — the conversion must be faithful

## Definition of done

Before exiting zero, all of:

- [ ] `output/book.epub` exists
- [ ] `tools/run-epubcheck output/book.epub` returned pass
- [ ] `output/report.json` exists and validates against `report.schema.json`
- [ ] No verify gate returned `fail`
- [ ] Every `warn` finding in `report.json` has a `human_message` written for the human user

If any of these is not true, exit non-zero and let the orchestrator decide the item's fate (paused, quarantined, retried).
