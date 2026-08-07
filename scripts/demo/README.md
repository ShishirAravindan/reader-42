# The acceptance suite

The demo/capture script **is** the acceptance test (see `.claude/CLAUDE.md`).
jsdom cannot do layout, so every geometry-dependent invariant in this reader is
proven here, driving the real app in a real browser, and the screenshots in
`out/` are the byproduct rather than the point.

There is **one** suite and CI runs all of it. A behavior with no scene is a
claim.

```sh
bun run demo              # the whole suite: asserts, then captures
bun run demo -- --headed  # watch it happen
bun run demo -- --video   # record it into out/
```

## First run

Playwright's browser is not part of `bun install`, so a cold clone needs it
once:

```sh
bun install
bunx playwright install chromium
bun run demo
```

To use a chromium you already have instead, point `PW_CHROMIUM` at the
executable (not its directory) and skip the install:

```sh
PW_CHROMIUM=/path/to/chromium bun run demo
```

Unset, the harness lets Playwright resolve its own install, which is what CI
does.

## Layout

| File | What it is |
|---|---|
| `run.ts` | Entry point. Imports the scenes for their registration side effect, then runs them. |
| `harness.ts` | Spawns the dev server against a throwaway library, launches chromium, and provides `scene`, `expect`, `expectEq`, `capture`, `onPhone`, `onFreshDevice`. |
| `scenes.ts` | The scenes. Registration order is execution order. |
| `showcase.ts` | Not a gate: a narrated walkthrough for evidence packs (`bun run showcase`). |
| `pwa-shell.shots.yml` | Optional shot-scraper frames of the welcome screen. Not a gate. |

Scenes share one page on purpose, in order, so a scene may rely on the state
the previous one left. A scene that needs a device of its own (a service
worker that has never installed, an empty cache, the network cut) takes one
with `onFreshDevice`; a scene that needs touch and a phone screen uses
`onPhone`. Both close their context when they return.

Adding a scene means calling `scene(name, fn)` in `scenes.ts`. An empty
registry is a hard failure, not a pass: a suite that can go green by running
nothing is worse than no suite.

## When one fails

The run stops at the first failure, prints the assertion with actual and
expected, and writes `out/FAIL-<scene>.png`. CI uploads `out/*.png` on every
run, red or green.
