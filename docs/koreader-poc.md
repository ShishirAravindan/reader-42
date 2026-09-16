# KOReader as the reading surface: a spike

Scaffolding, like [`salvage.md`](salvage.md) and [`kindle-parity.md`](kindle-parity.md).
It answers one question with running code and leaves the decision alone. Delete
it once the question is settled either way.

**The question.** If KOReader became the reading surface — because it is
battle-tested, because its typography is a CSS surface, because it is a decade
of ergonomics nobody here has to write — could reader-42 keep the shelf and the
plumbing to Logseq? What does a reading session lose in the crossing?

**Not in scope.** Forking KOReader, patching its UI, or writing a line of Lua.
This measures the seam. If the seam does not hold, nothing upstream of it
matters.

## What was built

One directory, `src/koreader/`, and nothing in the shipped app imports it.

| File | What it does |
|---|---|
| `lua.ts` | Parses KOReader's sidecar serialization. A parser, never `dofile`. |
| `sdr.ts` | Its annotation schema, mapped onto reader-42's vocabulary. |
| `resolve.ts` | Finds a KOReader highlight in reader-42's coordinate system. |
| `ingest.ts` | The whole seam, plus the report that measures it. |

Plus `scripts/koreader-seam.ts` (run it over real files), the `koreader-seam`
acceptance scene, and `scripts/demo/koreader.showcase.ts` (the recording).

```sh
bun scripts/koreader-seam.ts --book pride.epub --sidecar metadata.epub.lua
bun scripts/demo/koreader.showcase.ts --book pride.epub   # the recording
```

The test fixture, `test/fixture-koreader-sidecar.lua`, was serialized by
KOReader's *own* `frontend/dump.lua` in ordered mode, wrapped exactly as
`util.writeToFile` wraps it. The annotation text is real Pride and Prejudice
prose. What is synthesized is the reading session itself — no device here could
run KOReader — so the file's *shape* is authentic and its *content* is staged,
including one deliberate miss.

## The finding

Run against Gutenberg's Pride and Prejudice (16 spine items, 61 chapters):

```
  progress from KOReader   29.1%
  highlights resolved      3/4  (75%)      ← the 4th is the planted miss
    via the DocFragment    3  (100% of resolved)
  ambiguous (text repeats) 0
```

**An xpointer splits in two, and only one half travels.**

```
/body/DocFragment[3]/body/div/p[2]/text().59
 \_______________/ \_________________________/
   the spine item     crengine's own DOM
   portable           not portable
```

The `DocFragment` index is the spine item, which is the same spine reader-42
counts. Everything after it is a path through crengine's normalized internal
tree — versioned, in the sidecar, by `cre_dom_version` — and that is not the
tree a browser builds from the same XHTML. So the tail is useless here and the
head is a hint.

**Text is the real locator.** A highlight is found by matching its text, using
the DocFragment only to search the right chapter first. The recovered
boundaries are provably the same numbers `annotate.ts` would have written for a
selection made here — that equivalence is pinned by unit tests against
`serializeRange`, and the `koreader-seam` scene proves the resulting highlight
is actually *drawn*, with real geometry, in a real browser. jsdom cannot make
that assertion, and a locator that resolves to a zero-width box passes every
unit test.

### What crosses

- **Highlights** — text, note (multi-line intact), colour, creation time.
- **Progress** — KOReader's `percent_finished`, straight onto the shelf.
- **Reading state** — its `summary.status`.
- **Chapter titles, better than ours.** crengine follows the TOC at a finer
  grain than a spine item. On this book it knows a highlight was in
  "CHAPTER I."; reader-42 can only name the file, and calls it "I hope Mr.
  Bingley will like it. CHAPTER II." This is a genuine gain from the crossing.

### What does not

- **The reading position.** This is the one that matters. Progress crosses as a
  percentage; *where you were* does not, because that is exactly the
  crengine-DOM tail. Open a book in reader-42 after reading it on a device and
  you land on the cover with the shelf saying 29%.

  Which is survivable only under one reading of the arrangement: **if
  reader-42 stops being a reader.** If reading happens solely in KOReader, the
  position never needs to cross — the device keeps it. If both are readers,
  product law 2 is broken in the most visible way there is.

- **Deletions.** The sidecar merge unions by id (decisions.md 2026-08-01), so a
  highlight deleted on the device comes back on the next ingest. Same
  tombstone problem already recorded there, one step worse.

- **Those better chapter titles, into the app.** `book.json` has nowhere to put
  a chapter label — highlights carry a spine index, and the title is derived.
  The CLI export uses KOReader's label; the notebook panel cannot, and shows
  the derived one. Fixing that means widening the sidecar format, which is the
  owner's file and not a spike's to change.

## What it would cost, beyond the seam

- **One-way by construction.** Nothing here writes back to a sidecar it does
  not own. Two-way sync of two apps' formats is a different project.
- **The handoff.** Launching KOReader from the shelf is an app switch (Android
  intent, desktop argv). Product law 2 wants one tap and no decisions.
- **AGPL-3.0.** Fine personally; a live constraint on the "productization stays
  possible" clause in `vision.md`.
- **iOS.** Parked, not solved. iOS forbids runtime codegen, LuaJIT hard-disables
  its JIT there, and there is no official target — so this arrangement has no
  iPhone story, which is where product law 5 lives.

## What is left to decide

The seam holds. That was the open technical question and it is now closed: a
device's highlights arrive as first-class reader-42 highlights, render in the
page, and export to Logseq through the app's own exporter.

What remains is not technical. If reading moves to KOReader, what is left here
is a shelf, a state machine, and a highlights exporter — and `non-goals.md`
refuses to be a library manager. `vision.md` calls the from-scratch reader "the
core" and "the bare minimum first step, and the hardest".

That is an owner's call, and it belongs in `decisions.md` in the owner's voice,
whichever way it goes.
