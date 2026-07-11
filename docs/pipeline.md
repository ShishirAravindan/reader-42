# Pipeline

Ideas with a pulse: believed in, deliberately not now. This file replaces most of what v1 called non-goals — the durable refusals stayed in [`non-goals.md`](non-goals.md); everything that was really *"not yet"* lives here. Roughly ordered within each theme. Promotion out of this file happens in the roadmap, deliberately.

## Sense of place — what screens lost from paper

- **Book map** — a zoomed-out minimap of the whole book: chapters as blocks, highlights/bookmarks as tick marks, position as a cursor. Candidate signature UI; waits for the reader core to be excellent first.
- **Time left in chapter**, computed from the owner's measured pace, not generic WPM.
- **Footnote/endnote popovers** — tap → inline popover instead of a position-destroying jump.
- **Dictionary / Wikipedia long-press lookup** — bundled offline dictionary keeps it local-first.

## The reward loop — raise the value of having read

- **Finishing ritual** — marking a book finished opens a closing page: highlights in sequence, time in the book, a prompt for a 3-sentence verdict.
- **Per-book afterpage** — every finished book keeps its highlights + verdict forever; the "what this book left in me" archive, and exactly what exports to Logseq.
- **Reading log stats** — heatmap, hours/week, pace trends, finished-vs-DNF honesty, finish-date forecasts.
- **Weekly digest** and an annual **reading wrapped**.

## Ecosystem plumbing — beyond highlight export

- **Programmatic import endpoint** so reflow-to-epub can deposit straight into the library (the on-deck cap preserves the anti-inbox spirit).
- **Webhooks on events** (book finished, highlight created) — push to Logseq/anywhere instead of pull-only export.
- **Agent query skill** — the written companion to the API: how an agent asks "what am I reading?", "what have I highlighted about X?".

## Further out

- **TTS read-aloud with position sync** — switch between reading and listening mid-book; expands the habit into commutes.
- **Productization proper** — packaging, install story, docs for strangers; multi-user/hosted only if the door is walked through deliberately (a `decisions.md` entry, not drift).
- **Cover art enrichment**, series grouping, OPDS — if dogfooding demands them.
