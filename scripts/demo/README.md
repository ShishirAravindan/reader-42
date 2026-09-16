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
| `narrate.ts` | The caption strip, the tap marker, the two ways a recording clicks, and the narration clock. Shared, so a second recording cannot grow its own copy. |
| `voice.ts` | Spoken narration: local TTS per caption, and the mix onto the video. |
| `koreader.showcase.ts` | Not a gate: the KOReader spike, recorded (`docs/koreader-poc.md`). |
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

## Narrated recordings

The captions are also spoken, by [Piper](https://github.com/rhasspy/piper) —
a small neural TTS that runs entirely on this machine. No API, no key, and
nothing on the network at synthesis time.

Sync is by construction, not by editing: `say()` synthesizes the line *before*
showing the caption, holds the caption for at least as long as the speech
lasts, and records the offset against the clock the video started on. Mixing is
then pure placement. A line that needs four seconds gets four seconds, instead
of being cut off by a hold someone guessed at a year ago.

Setup, once:

```sh
pip3 install piper-tts
mkdir -p scripts/demo/voice && cd scripts/demo/voice
curl -sSLO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -sSLO https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

The model is 63MB and gitignored — downloaded, never committed (`decisions.md`
2026-08-01 bounds in-tree assets to the ones the reading act depends on, and a
demo voice is not one). `PIPER_MODEL` points somewhere else if you prefer.
`ffmpeg` does the mix.

Narration is on by default and degrades to silence: no model, no piper, or no
ffmpeg and the recording runs exactly as it did before, same timings, and says
why. `--silent` turns it off deliberately.

Synthesized lines are cached by content under `out/voice/`, so re-running after
changing one caption re-synthesizes one line rather than all of them.

**Written text is not spoken text.** `voice.ts` keeps a small pronunciation
map — an em dash is a pause rather than a word, and "reader-42" said literally
comes out "reader minus forty two". Only the audio changes; the caption on
screen stays exactly as written.
