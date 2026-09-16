# KOReader as the reading surface: a spike

Scaffolding, like [`salvage.md`](salvage.md) and [`kindle-parity.md`](kindle-parity.md).
It answers a question with running code and leaves the decision alone. Delete it
once the question is settled either way.

**The question.** If the reading experience is already battle-tested and good
enough elsewhere, can reader-42 be the library — and is that a smaller thing or
a different thing?

Two directions were built, and they are not the same proposal.

| | What it makes KOReader | What it makes reader-42 |
|---|---|---|
| **A. Ingest** | a data source | still a reader |
| **B. Shelf** | the reading surface | the library, and nothing else |

**B is the real proposal.** A was built first and it quietly begs the question:
its climax is a device's highlight rendered in *our* reader, which only proves
we can still read. If KOReader is the reader, that is the wrong thing to prove.

Not in scope either way: forking KOReader, patching its UI, or writing Lua.

## B — the shelf, with no reader

```sh
LIBRARY_DIR=/path/to/koreader/library bun scripts/shelf-dev.ts
bun scripts/demo/shelf.showcase.ts --library /path/to/koreader/library
```

**KOReader's folder is the library.** Not imported into one — it *is* one:

```
<library>/
  Pride and Prejudice.epub
  Pride and Prejudice.sdr/metadata.epub.lua     ← the device's own file
  Emma.epub                                     ← never opened; still on the shelf
```

No `library.json`. No `book.json`. No import step. No id of our own. A book is
on the shelf because the file is in the folder, and everything known about it
is what the device wrote. This is the part that costs something: reader-42
gives up its own storage format, the thing `decisions.md` (2026-07-12) called
the contract, and adopts KOReader's.

**`src/shelf/` has no viewport and no code path to one.** Tapping a book opens
a dialog that says *reader-42 does not open books. KOReader does*, and shows the
handoff. That absence is the argument.

What it turns out to be good at, and none of it needs a reader:

- **A shelf** — covers pulled out of the EPUBs in the browser with the zip
  reader this project already owns, on-deck capped at five, progress as a
  hairline on the cover.
- **Four honest states**, including the one most shelves refuse: KOReader's
  `abandoned` is DNF, recorded by the reader that watched you stop.
- **A cross-book notebook.** Every highlight in the library, searchable —
  *where did I read about night?* answered across the whole shelf at once. A
  per-book file browser structurally cannot do this, and KOReader's isn't
  trying to.
- **The off-ramp to Logseq**, one outline per book, through reader-42's own
  exporter — with chapter titles from the device, which are *better than ours*
  (crengine follows the TOC at a finer grain than a spine item).

## A — ingest, and the one durable finding

Built first, kept because its measurement is what makes B safe.

```
progress from KOReader   29.1%
highlights resolved      3/4  (75%)      ← the 4th is a planted miss
  via the DocFragment    3  (100% of resolved)
```

**An xpointer splits in two, and only one half travels.**

```
/body/DocFragment[3]/body/div/p[2]/text().59
 \_______________/ \_________________________/
   the spine item     crengine's own DOM
   portable           not portable
```

The `DocFragment` index is the spine item, the same spine reader-42 counts.
Everything after it walks crengine's normalized internal tree — versioned in
the sidecar by `cre_dom_version` — which is not the tree a browser builds. So
highlights are located by matching their **text**, with the DocFragment only
choosing which chapter to search first. The recovered boundaries are provably
the numbers `annotate.ts` writes for a selection made here (pinned against
`serializeRange`), and the `koreader-seam` scene proves the result is actually
*drawn*, with real geometry, in a real browser.

**Why this matters for B:** the thing that does not cross is the reading
*position*, and under B nothing needs it to. The device keeps place because the
device does the reading. The finding that made A awkward is the finding that
makes B clean.

## What is built

```
src/koreader/lua.ts       parses KOReader's sidecar format (a parser, never dofile)
src/koreader/sdr.ts       its annotation schema, in our vocabulary
src/koreader/library.ts   a KOReader folder, read as the library          ← B
src/koreader/cover.ts     cover art out of an EPUB without opening it     ← B
src/koreader/resolve.ts   finding a device highlight in our coordinates   ← A
src/koreader/ingest.ts    the ingest seam, and the report that measures it ← A
src/shelf/main.ts         reader-42 with no reader                        ← B
```

Plus `scripts/shelf-dev.ts`, `scripts/koreader-seam.ts`, the `koreader-seam`
acceptance scene, and two recordings under `scripts/demo/`.

The test fixture was serialized by KOReader's *own* `frontend/dump.lua` in
ordered mode, wrapped exactly as `util.writeToFile` wraps it, over real
Gutenberg prose. What is synthesized is the reading session — no device here
could run KOReader — so the file's shape is authentic and its content staged.

## What it costs, honestly

- **Deletions resurrect.** Ingest unions by id, so a highlight deleted on the
  device returns. Same tombstone gap as `decisions.md` (2026-08-01), one worse.
- **The handoff is an app switch.** Under B, product law 2 has to be *reassigned*
  rather than met: KOReader serves the boredom moment (it resumes instantly),
  and reader-42 becomes the place you go deliberately. Friction asymmetry still
  holds — it just points at a different app.
- **AGPL-3.0**, a live constraint on the "productization stays possible" clause.
- **iOS.** Parked, not solved. iOS forbids runtime codegen, LuaJIT disables its
  JIT there, no official target. Under B this is the sharpest cost, because
  reading is the part that would have no iPhone story.
- **No stats.** KOReader keeps real reading statistics in its own database, not
  the sidecar. The shelf shows a last-touched date derived from annotations and
  nothing more; the reading log in `vision.md`'s *Next* tier would need that
  database, which is a further dependency on KOReader's internals.

## What is left to decide

The technical question is closed in both directions. What remains is one
sentence in `vision.md`: whether "the core" is the from-scratch reader, or the
library and the plumbing around a reader someone else already perfected.

`non-goals.md` currently refuses to be a library manager. That refusal was
written when reader-42 owned the reading; under B it is not a wall, it is the
doc that would get rewritten — the way the 2026-07-11 re-founding rewrote the
telos. A spike does not get to make that call, and this one does not.
