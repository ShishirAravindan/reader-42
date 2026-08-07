# CLAUDE.md — reader-42

You are working on **reader-42**, a local-first e-reader: an exceptional EPUB reading experience, a beautiful library, and thin plumbing into the owner's information ecosystem (highlights out to Logseq). Read `docs/vision.md` (thesis, product laws, now/next/later) and `docs/non-goals.md` before substantive work. `docs/decisions.md` is the append-only decision log. **Load-bearing choices are the owner's to make**, recorded there in their voice; agents implement against them and never mint decisions silently.

Capture and conversion are out of scope. [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub) owns URL/PDF → EPUB entirely.

## Branch model

`main` is the stable branch; don't destabilize it. Development targets **`dev`**: branch from dev, PR against dev, squash-merge to dev. `dev` merges to `main` when the owner judges it sufficiently stable.

## Architecture

See `docs/decisions.md` (2026-07-12 entries) for the reasoning. The shape:

- **App:** vanilla TS/HTML/CSS home-screen PWA. No framework, no EPUB-rendering library, zero runtime dependencies in the shipped app.
- **Storage:** no server, no database. The library is a folder of files (`book.epub` + `book.json` sidecar per book, `library.json` master index) synced through the owner's cloud drive, accessed via a small storage interface; the drive client is one swappable transport. Search is a derived, disposable index.
- **Offline:** the current book and on-deck queue live fully on the device; reading never needs the network; writes queue and flush when online, latest timestamp wins.
- **Tooling:** TypeScript strict, Bun for build/tests (ships nothing), Biome for lint/format; bootstrapped fresh by the rewrite, deliberately.

Load-bearing constraints: files are the contract; zero runtime deps in the shipped app; position locators are structural and mode-independent.

The previous implementation lives in git history (tree at `d124d02`); its lessons are in `docs/salvage.md`. Read the salvage audit before writing reader, locator, or EPUB code.

## Repo layout

```
docs/
  vision.md         # telos, product laws, now/next/later
  non-goals.md      # durable refusals
  decisions.md      # append-only decision log, owner's voice
  salvage.md        # lessons from the previous implementation (scaffolding)
.claude/            # this file, agents/, skills/
```

Code layout gets established by the rewrite's first PRs against the decisions.

## Conventions

- **Branches:** `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`, `test/`, `perf/`, `build/` + 2-4 kebab-case words. Never `claude/<wacky>`.
- **Commits:** conventional, single-line preferred, atomic. No trailers, no `Co-Authored-By`.
- **PRs:** one per feature, against `dev`, squash-merged; title = the squash commit message. Keep bodies short and plain. PRs touching user-visible behavior attach a screenshot or short recording; build/refactor/docs PRs don't. A PR merging `dev` into `main` attaches an end-to-end demo recording of the reader. Never overwrite a PR body the owner has edited; fetch the current body first and apply the minimal delta in their style.

## Definition of done

1. typecheck clean 2. lint clean 3. behavioral tests cover the change 4. the flow was exercised end-to-end in the running app, with an evidence capture when user-visible 5. PR names what changed, why, how verified 6. branch/PR conventions followed.

For UI work, the demo/capture script **is** the acceptance test. Write it first-class and keep its assertions; screenshots are the byproduct. The worst rendering bugs are only catchable this way.

## Quick references

| Want to | See |
|---|---|
| Understand the product | `docs/vision.md`, `docs/non-goals.md` |
| Understand a past decision | `docs/decisions.md` |
| Write reader/locator/EPUB code | `docs/salvage.md` first |
