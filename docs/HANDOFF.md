# Handoff — current state and the next move

> Living doc. A future session reads this *after* `.claude/CLAUDE.md` to learn what's been built and what to pick up.

## State as of 2026-07-03 — post re-scope

**The project was re-scoped (ADR 0005): reader-42 is now the library + reader + highlights off-ramp only.** Capture and conversion moved to the sibling repo [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub); all convert code (worker, capture routes, workspace template, verify toolbox + its 25 tests) was deleted from this repo. The pre-rescope handoff (vertical slice: paste URL → convert → read) is obsolete — do not resurrect it.

### What's here now

| Layer | Status | Where |
|---|---|---|
| Vision + non-goals + roadmap + ADRs (5) | ✅ re-scoped | `docs/` |
| Repo agent context (CLAUDE.md, pr-reviewer) | ✅ | `.claude/` |
| TS + Bun + Hono + Drizzle + Biome foundation | ✅ | root configs, `apps/` |
| Server skeleton — items table (`unread→reading→finished\|dnf`), library/reader routes | ✅ | `apps/server/src/` |
| EPUB reader (no deps) — parser, renderer, fixture, standalone dev server | ✅ | `apps/web/` |
| **M1 dogfoodable core** — import UI, library UI, reader served by server, positions | ⏳ | *next* |

### Decisions already made (don't re-ask)

From the re-scope session, recorded in ADR 0005:

- **Ingest = manual UI import only** (drag-drop / file picker). No watcher, no import endpoint.
- **Reading model = scroll first, pagination later as a toggle**; position locator must be mode-independent from day one.
- **Devices = Mac + tablets (incl. Android) via LAN PWA. No cloud backend, ever** — Convex considered and rejected; Tailscale is the future remote-access answer.
- **Enhancement priority: search → stats → typography depth**; highlights + **Logseq** export after the core.
- **Review model = milestone evidence docs** (shot-scraper captures under `docs/evidence/<milestone>/`); aesthetics decided mockups-first in M1.

## The next move: M1 (see `docs/roadmap.md`)

1. Import flow — `POST /library/import` + drag-drop/picker UI, OPF metadata parse, store under `data/epubs/`
2. Library list UI with state transitions, opens books into the reader
3. Serve `apps/web` from the Hono server on `:4242` (kill the standalone-only setup)
4. Scroll mode with stable positions
5. Aesthetic mockup variants → evidence doc → user picks direction

## How to pick up

```bash
bun install
bun run typecheck && bun run lint
bun run dev        # server on :4242
```

Read in order: `.claude/CLAUDE.md` → `docs/vision.md` + `docs/non-goals.md` → `docs/roadmap.md` → `docs/decisions/0005-*.md` → `docs/diary.md`.

## Known gotchas

- **`data/` is gitignored** — library DB and EPUBs live there. Never commit it. Same for `.claude/worktrees/`.
- **Lefthook auto-installs on `bun install`** — typecheck + lint pre-commit hooks are active.
- **No tests currently exist** — the deleted verify toolbox held them all. M1 features must bring their own (Bun test for server/parsing, Playwright for reader flows).
- **Subagent worktree/sandbox quirks** — see `docs/diary.md` entries of 2026-05-09 before spawning parallel agents.
- **Evidence captures** — `uvx shot-scraper` works in dev environments (Playwright Chromium pre-installed in remote sessions).
