# CLAUDE.md — reader-42

You are working on **reader-42**, a local-first e-reader: an exceptional EPUB reading experience, a beautiful library, and thin plumbing into the owner's information ecosystem (highlights out to Logseq). Read `docs/vision.md` (thesis, product laws, now/next/later) and `docs/non-goals.md` before substantive work. `docs/decisions.md` is the append-only decision log. **Load-bearing choices are the owner's to make**, recorded there in their voice; agents implement against them and never mint decisions silently.

Capture and conversion are out of scope. [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub) owns URL/PDF → EPUB entirely.

## Branch model

`main` is the stable branch; don't destabilize it. Development targets **`dev`**: branch from dev, PR against dev, squash-merge to dev. `dev` merges to `main` when the owner judges it sufficiently stable.

## Stack

- **Runtime:** Bun · **Language:** TypeScript, strict (`noUncheckedIndexedAccess`, `noImplicitOverride`)
- **Server:** Hono on `:4242`, serves the API and the web reader (LAN-reachable)
- **DB:** SQLite via better-sqlite3 + Drizzle (schema is the type source of truth); FTS5 for search
- **Validation:** Zod at every boundary · **Frontend:** vanilla TS/HTML/CSS, no framework, no EPUB-rendering library
- **Lint+format:** Biome · **Pre-commit:** Lefthook (typecheck + lint)

Stack revisions are owner decisions (see `docs/decisions.md`). Load-bearing constraints: local-first; no deps in the core app; position locators are structural and mode-independent.

## Repo layout

```
apps/
  server/           # Hono API + static serving of the reader
  web/              # PWA reader + library UI (vanilla TS, no deps)
data/               # NEVER COMMITTED — library.db, EPUBs (gitignored)
docs/
  vision.md         # telos, product laws, now/next/later
  non-goals.md      # durable refusals
  decisions.md      # append-only decision log, owner's voice
.claude/            # this file, agents/, skills/
```

## Conventions

- **Branches:** `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`, `perf/`, `build/` + 2-4 kebab-case words. Never `claude/<wacky>`.
- **Commits:** conventional, single-line preferred, atomic. No trailers, no `Co-Authored-By`.
- **PRs:** one per feature, against `dev`, squash-merged; title = the squash commit message. Keep bodies short and plain. PRs touching user-visible behavior attach a screenshot or short recording; build/refactor/docs PRs don't. Never overwrite a PR body the owner has edited; fetch the current body first and apply the minimal delta in their style.

## Definition of done

1. `bun run typecheck` clean 2. `bun run lint` clean 3. behavioral tests cover the change 4. the flow was exercised end-to-end against a running server, with an evidence capture when user-visible 5. PR names what changed, why, how verified 6. branch/PR conventions followed.

For UI work, the demo/capture script **is** the acceptance test. Write it first-class and keep its assertions; screenshots are the byproduct. The worst rendering bugs are only catchable this way.

## Quick references

| Want to | See |
|---|---|
| Understand the product | `docs/vision.md`, `docs/non-goals.md` |
| Understand a past decision | `docs/decisions.md` |
| Run the server | `bun run dev` (port 4242) |
| Typecheck / lint | `bun run typecheck` / `bun run lint` |
| Health check | `curl http://localhost:4242/health` |
