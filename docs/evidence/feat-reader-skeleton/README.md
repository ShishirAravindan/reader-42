# Evidence pack — feat/reader-skeleton

## Environment note

The agent that completed this PR was run inside a sandboxed Claude Code worktree where:

- `bun install` is blocked by the harness sandbox (no `node_modules/` could be created in the worktree)
- `bun run …`, `bun run server.ts`, and headless-browser tools are likewise blocked
- Read-only `bunx tsc` and `bunx biome` are allowed (they cache transpilers separately) and were used for verification

A screenshot of the running reader could not be captured from inside the agent. This file is the
written transcript fallback called for in `.claude/CLAUDE.md`. The reviewer should treat replicating
the steps below in their own checkout as the visual evidence step.

## Manual verification steps for a reviewer

```bash
# from the repo root
bun install                                  # populates node_modules across workspaces
bun run apps/web/scripts/build-fixture.ts    # writes apps/web/public/fixtures/test-book.epub
bun run apps/web/server.ts                   # serves the reader on :5173
open http://localhost:5173                   # opens the reader UI
```

Then in the running reader:

1. Click **Open test fixture** in the topbar. The fixture EPUB loads; the title becomes
   "The Test Volume" and the author "reader-42 fixtures".
2. The TOC sidebar shows three top-level entries (Prologue, Chapter One, Epilogue) and a nested
   sub-entry "A Second Scene" under Chapter One.
3. Click any TOC entry — viewport jumps to that chapter; the entry is highlighted with the
   accent color.
4. Click the nested "A Second Scene" entry — viewport jumps to Chapter One and scrolls to
   the `#scene-2` anchor inside the chapter.
5. Press the **right arrow** key (or PageDown) — advances to the next spine chapter.
6. Press **left arrow** — returns to the previous chapter.
7. Click the bottom-bar **Prev/Next** buttons — same behavior; disabled at the spine bounds.
8. Click **A-/A/A+** — chapter font scales between 0.9, 1.0, 1.15.
9. Click **Light/Sepia/Dark** — host page and chapter shadow root both repaint to the new theme.
10. Reload the tab — title, scroll position, font scale, and theme persist via `localStorage`
    keyed by the SHA-256 prefix of the EPUB content.
11. The hamburger button collapses/expands the TOC sidebar.

## Automated verification (run inside the agent worktree)

```bash
$ bunx tsc --noEmit -p tsconfig.json    # apps/web is clean
# (apps/server emits 2 errors only because node_modules is absent in this worktree;
#  resolves once `bun install` runs)

$ bunx biome check apps/web             # clean
$ bunx biome check .                    # clean across the repo
```

## What `apps/web/` contains

- `src/epub/` — minimal OCF/OPF/Nav/NCX parser plus a STORED+DEFLATE ZIP reader (no deps)
- `src/reader/` — chapter renderer (shadow-DOM sandboxed, blob-URL resource resolution),
  UI controller (TOC, controls, keyboard, prev/next), localStorage state
- `scripts/build-fixture.ts` — generates a tiny self-contained EPUB3 fixture for testing
- `server.ts` — Bun dev server (devtime only; no runtime deps)
- `index.html`, `styles.css`, `src/main.ts` — host page and bootstrap
