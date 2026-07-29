# Kindle parity: the core reading act

Scaffolding for the reader rebuild. It enumerates the nuances of the Kindle
in-book reading experience so we can clone the core act faithfully, then maps
each to reader-42 and turns the list into a backlog. Like [`salvage.md`](salvage.md),
this is a working spec, not a durable doc; delete it once the reader ships.

## Scope

**In scope: the act of reading one open book.** Open, turn pages, adjust
typography, navigate, select and look up, highlight, track progress and time
left, bookmark, resume. Everything a reader touches between opening a book and
closing it.

**Out of scope here:** the library/home shell, the store, and the Kindle
"extras" that are not the reading act itself (X-Ray, Word Wise, Vocabulary
Builder, Popular Highlights). Those are collected in the [non-core appendix](#non-core-appendix)
with a keep/adapt/refuse verdict, so the core spec stays clean.

## Fidelity principles

1. **Kindle is the parity baseline, not the ceiling.** This doc captures the
   floor: match the core act as it actually behaves. reader-42's own
   improvements (the book map, the last-line re-orientation marker, the
   finishing ritual) are the vision's *Next* tier and stay out of this doc.
2. **Structural locators are the substrate.** Kindle's device-independent
   "Locations" and reader-42's structural locators (spine item, element path,
   offset) solve the same problem. We keep our locators as the source of truth
   and *derive* a linear location number for display, rather than adopting
   Kindle's byte-offset scheme. See [Position and progress](#b-position-and-progress).
3. **Cloud- and social-dependent behavior is refused or adapted, never cloned.**
   Anything backed by Amazon's servers (Popular Highlights, cross-device sync
   prompts, cloud X-Ray data) collides with the local-first architecture and,
   for the social ones, with [`non-goals.md`](non-goals.md). Where the *value*
   is worth keeping, we generate it locally; where it is the attention economy
   returning, we refuse it.
4. **Collisions with our product laws are flagged inline, not silently
   resolved.** A ⚠︎ marks each place "exactly as is" fights a product law or an
   architecture constraint. Those flags are the batched question set for the
   owner at kickoff; nothing load-bearing gets decided in this doc.

## How to read the tables

Each nuance is one testable line item: a Kindle behavior, its fidelity note,
and the reader-42 mapping (what v1 already proved, what the salvage audit
warns, what is new work). One line item maps to one backlog task and one
demo-script assertion. Legend: **✓** v1 built it and it transfers; **~** partial
or needs rework; **✗** not built; ⚠︎ collision to decide.

---

## A. Reading surface and page model

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| A1 | **Paginated is the default mode.** Discrete pages; the last line of a page is never split across the page break. | Default paginated. | ~ v1 shipped paged mode (CSS columns); v2 is scroll-only today. Salvage §2: columns must overflow the host horizontally or `scrollWidth` is zero. |
| A2 | **Continuous scrolling is an opt-in toggle** (Layout tab). Vertical scroll like a web page. | Keep as the alternate mode; positions survive the switch. | ~ v2 has scroll today; needs the toggle and mode-invariant restore. Salvage §1: locators are axis-independent by design. |
| A3 | **Tap zones:** right ~⅔ turns forward, left ~⅓ turns back; a center/top tap reveals chrome. Mirrored for RTL. | Clone zone geometry and RTL mirroring. Adjustable zones are a nicety, not core. | ✗ new. v1 had center-tap-for-chrome and edge clicks; formalize the three-zone model. |
| A4 | **Swipe left/right also turns pages**, with a quick slide/fade transition. | Clone swipe + a subtle transition. No skeuomorphic page curl. | ✗ new (touch). Salvage §4: keyboard turns (Space, arrows, PageUp/Down) are also day-one. |
| A5 | **Page geometry:** column width is capped to a comfortable measure; surplus width becomes symmetric margins, so a wide window still reads like a page. | Clone the measure cap. | ✓ v1 solved this exactly (salvage §2: column stride = clientWidth, cap at measure, surplus to margins). |
| A6 | **Book-boundary behavior:** a gentle stop at the first/last page, no wrap. | Clone. | ✗ new. Salvage §4: end of last chapter must report progress 1 and nudge *finished* (see B4). |

⚠︎ **A1 default mode.** The vision lists both modes without naming a default.
Kindle's default is paginated. Recommend paginated default to match parity;
confirm at kickoff.

## B. Position and progress

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| B1 | **Locations:** a device-independent address, stable across font/size/margin changes. One location unit is a fixed span of the text (roughly 128 characters). Shown as "Location X of Y". | Adapt, do not clone the byte scheme. Derive a linear character-offset index from our structural content; render "Location X of Y" from it. | ~ v2 has structural locators (the source of truth). The linear display index is new; salvage §7 notes character counts already exist for this. |
| B2 | **Real page numbers** when the book carries print-edition page-map data ("Page X of Y"); otherwise locations only. | Clone: use the EPUB page-list nav when present, fall back to locations. | ✗ new. Parser reads nav already (salvage §3); page-list extraction is the addition. |
| B3 | **Progress cycles on tap** of the bottom status: time left in chapter → time left in book → location/page → % → (off). | Clone the cyclable status line and its states. | ✗ new. |
| B4 | **Percent complete is honest about length.** | Length-weighted progress. | ⚠︎ Salvage §7: v1 was chapter-count weighted and "the percentage lies." Parity forces length-weighting off character counts. |
| B5 | **Time left is adaptive:** the reader measures your pace ("Learning reading speed" on first open) and computes minutes-left-in-chapter and hours-left-in-book from it, per book. | Clone: measure words/min over recent reading, store per book, recompute continuously. | ✗ new. Reading sessions existed in v1 (salvage §5) as the substrate. |
| B6 | **End of book reports complete** and offers the finished state. | Clone. | ✗ new; the single most jarring v1 bug when absent (salvage §4). |

## C. Typography (the Aa panel)

Kindle groups these under **Font**, **Layout**, and **Themes** tabs.

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| C1 | **Font family:** a curated set of embedded reading faces (a signature serif, a sans, publisher default, a dyslexia-friendly face). | Clone the *shape*: a small curated set of bundled, licensed faces. Pick our own faces; do not ship Amazon's. | ✗ new. v2 has no font control yet. |
| C2 | **Font size:** a slider/stepper across discrete sizes. | Clone as discrete steps. | ~ v1 had font-size control with re-anchoring on change (salvage §1). |
| C3 | **Bold weight:** several discrete boldness levels. | Clone as a few weight steps. | ✗ new. Lower priority. |
| C4 | **Line spacing:** a few presets (compact → wide). | Clone as presets. | ✓ v1 had leading presets. |
| C5 | **Margins:** a few presets (narrow → wide). | Clone as presets. | ✓ v1 had measure/margin presets. |
| C6 | **Alignment:** justified or left; proper hyphenation with justification. | Clone. Vision calls for hyphenation/justification "done properly." | ✗ new (alignment toggle + hyphenation). |
| C7 | **Orientation lock** (portrait/landscape) and a **reading ruler** (accessibility). | Include at parity; low priority. | ✗ new. |
| C8 | **Preference scope:** typography is global with per-book memory of where you were. | Recommend: typography is device-local taste (salvage §4: "taste is device-local, place is not"). | ⚠︎ Decide global vs per-book overrides. Salvage §7 flags split state ownership as a v1 debt; pick one rule. |

## D. Themes and page color

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| D1 | **Page color themes:** White, Sepia, Green, Black, selectable from the Aa panel. | Clone White/Sepia/Dark; Green optional. | ~ v1 shipped light/sepia/dark. Salvage §7: theme tokens were duplicated between shadow CSS and app CSS; unify. |
| D2 | **Book CSS is sandboxed;** the theme flows into the rendered content, book styles cannot leak out. | Clone exactly. | ✓ v1 proved this (shadow DOM + `:host` custom properties; salvage §2). |
| D3 | Auto light/dark following the system or a schedule. | Optional at parity. reader-42's "evening warmth" is a *Next*-tier improvement, kept out of this doc. | ✗ new; low priority. |

## E. Selection, dictionary, and lookup

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| E1 | **Long-press a word** pops an inline card without leaving the page: Dictionary / Wikipedia / Translation tabs. | Clone the interaction. Dictionary needs a bundled offline dictionary (the vision lists offline dictionary/Wikipedia as *Next*; the parity floor is the popup + a local dictionary). | ✗ new. Salvage §1: shadow-DOM selection is engine-specific (`shadowRoot.getSelection()` on Chromium, else document selection with containment check). |
| E2 | **Select a range** raises a menu: Highlight, Note, Search-in-book, Look up, Share. | Clone the menu; Share maps to our Logseq/copy off-ramp, not social. | ✗ new. |
| E3 | **Selection handles** drag to extend the range across words and lines. | Clone. | ✗ new (touch handles). |

## F. Highlights and notes

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| F1 | **Highlight colors:** four core (yellow, pink, blue, orange), rendered as a colored background on the text. | Clone the four; make color part of the highlight record. | ~ v1 had highlights but confirm color support. |
| F2 | **A note attaches to a highlight** (or a point); a marker shows in the margin/inline. | Clone. | ✓ v1 had highlights-with-notes (salvage §5). |
| F3 | **Highlight rendering must survive reload and a second highlight in the same paragraph.** | Clone the correctness rules. | ✓ hard-won in v1. Salvage §1: overlay marks must be invisible to locators; wrap each intersecting text node separately; `normalize()` on removal. |
| F4 | **Notebook view:** all highlights and notes for the book in one list, filterable, jump-to-location, exportable. | Clone the list + jump; export is our Logseq outline (highlight text, chapter title, deep link, optional note; salvage §5). | ~ v1 had export; the in-app notebook list is new. |
| F5 | **Deep link** to a specific highlight, copyable and restorable. | Clone (`#/book/:id/hl/:hid`). | ✓ v1 pattern (salvage §4). |

## G. Bookmarks

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| G1 | **Tap the top-right corner** to bookmark the page; a dog-ear ribbon appears; tap again to remove. | Clone the corner gesture + ribbon affordance. | ~ v1 had bookmarks on the locator; the corner-tap affordance is new. |
| G2 | **Bookmark list** in the Go To panel; jump to any. | Clone. | ~ combine with G1. |

⚠︎ **Bookmarks must follow the reader across devices.** Salvage §7: in v1
bookmarks lived in localStorage and did *not* sync. In v2 they belong in the
synced `book.json` sidecar (place is not device-local). Decide at kickoff.

## H. Navigation

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| H1 | **Go To panel:** Cover, Beginning, Table of Contents (chapter list), Page or Location entry, Notes & Bookmarks. | Clone the panel and its targets. | ~ v1 had TOC nav; the unified Go To panel is new. |
| H2 | **Footnote popover:** tapping a footnote reference shows it inline without navigating away. | Clone. | ✗ new; vision lists footnote popovers (there as *Next*, but it is core to the reading act, so include at the floor). |
| H3 | **Internal links** jump within the book and leave a "back" affordance to return. | Clone. | ~ v1 intercepted internal links; the back affordance is the addition. Salvage §2: internal links intercepted by UI, external get `target=_blank` + `noopener`. |
| H4 | **Page Flip:** swipe up from the bottom to a peek view (position slider + hovered-page preview, chapter-skip arrows, a 3×3 thumbnail grid), *without moving your reading position*; it remembers recent jump points and a "Back to location" returns you. | Signature feature. Clone the peek-without-losing-place model and the "back to where I was" stack. Thumbnails depend on the rendering unit (see debt below). | ✗ new; significant. Salvage §7 warns one-chapter-at-a-time rendering fights book-wide thumbnails; decide the rendering unit first. |
| H5 | **In-book search:** query to a results list with snippets and locations; tap to jump; matches flash on the page. | Clone. | ~ v1 had in-book find with flash, but only single-text-node matches and first-occurrence-per-chapter (salvage §7); improve to span inline tags and all occurrences. |
| H6 | **Browser/hardware Back returns to the shelf** from the reader. | Clone; routing must be real. | ✓ v1 pattern (hash routing; salvage §4). |

## I. Chrome and controls

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| I1 | **Chrome auto-hides** while reading; a center/top tap reveals a top bar and a bottom bar; an explicit control or Escape hides again. | Clone the conservative reveal/hide rule. | ✓ v1 pattern (salvage §4: taps restore, only an explicit control hides, Escape only restores/closes). |
| I2 | **Top bar** holds Back, Go To, Aa (typography), Search, Bookmark, and the notebook/share entry. | Clone the top-bar contents (minus non-core X-Ray). | ~ assemble from the pieces above. |
| I3 | **Bottom bar** holds the progress/location/time status (cyclable, B3) and the Page Flip affordance. | Clone. | ~ combine B3 + H4. |
| I4 | **Brightness / warm light.** | Hardware feature on devices; on an app this is the OS/screen. Out of the app's parity floor. | ✗ not app scope; note only. |

## J. Resume and cross-device continuity

| # | Kindle behavior | Fidelity note | reader-42 mapping |
|---|---|---|---|
| J1 | **Instant resume** to the exact last page on open. | Clone; it is a product law (resume in under a second). | ~ v2 device cache + structural resume already exist; wire into the reader. |
| J2 | **Furthest-read sync across devices**, with a prompt when another device is ahead. | Adapt: our synced sidecar already carries position; latest-timestamp-wins on flush. A conflict prompt is optional. | ~ storage seam + offline write queue already shipped. The prompt UI is new and optional. |

⚠︎ **J2 is the local-first analogue of Whispersync,** achieved through the synced
folder, not a cloud sync service. No Amazon-style account sync is in scope.

---

## Collisions to decide at kickoff

The ⚠︎ flags above, gathered as the batched question set:

1. **A1 Default reading mode** paginated (parity) vs scroll. *Recommend paginated default, scroll as toggle.*
2. **B4 Progress model** length-weighted (parity, honest) vs chapter-count (v1 debt). *Recommend length-weighted; character counts are already the substrate.*
3. **C8 Typography scope** device-local taste vs synced per-book overrides. *Recommend device-local taste; place (position, bookmarks, highlights) syncs, taste does not.*
4. **G/bookmarks sync** move bookmarks into the synced sidecar (fix the v1 non-sync debt). *Recommend yes.*
5. **H4 Rendering unit** one-chapter-at-a-time (simple) vs continuous/book-wide (needed for Page Flip thumbnails and book-wide page numbers). *This is the load-bearing architecture call; decide before building A/H.*
6. **J2 Cross-device conflict** silent latest-wins vs a resume prompt. *Recommend silent by default, prompt optional later.*

## Non-core appendix

Kindle behaviors deliberately excluded from the parity floor, each with a verdict.

- **Home / library shell** — separate concern. The library is its own milestone;
  the vision's law 2 ("resume the current book, no home screen") already governs it.
- **X-Ray** (book-wide index of people, terms, notable clips) — **adapt later,
  never clone.** The value (a sense-of-place index) is the vision's book-map
  *Next* tier and would be generated locally, not from Amazon's data.
- **Word Wise** (inline glosses over hard words) — **defer.** Depends on a
  gloss dataset; revisit as a local feature if dogfooding asks.
- **Vocabulary Builder** (looked-up words become flashcards) — **refuse as
  framed.** Gamified retention loop; the vision is "gentle, never gamified."
- **Popular Highlights** (dotted underline of what many readers highlighted) —
  **refuse permanently.** Social and cloud-backed; [`non-goals.md`](non-goals.md)
  bars re-importing the attention economy.
- **Whispersync cloud account sync** — replaced by the synced-folder architecture
  (J2); no account sync service.
- **Store, samples, subscriptions, read-aloud/Audible** — out of product scope
  (TTS is the vision's *Later* tier).

## Backlog

The line items above, sequenced into shippable epics. Each item is one task and
one demo-script assertion (the demo/capture script is the acceptance test).
Ordering respects the rendering-unit decision (collision 5), which gates the
page model and Page Flip.

**Epic 0 — Rendering-unit decision (spike).** Resolve collision 5; it gates A and H4.

**Epic 1 — Page model.** A1 paginated default, A3 tap zones, A4 swipe + keyboard
turns, A5 measure cap (port from v1), A6 boundaries, A2 scroll toggle with
mode-invariant restore.

**Epic 2 — Position, progress, time.** B1 location number, B2 print page numbers,
B4 length-weighted progress, B3 cyclable status, B5 adaptive time-left, B6
end-of-book completion.

**Epic 3 — Typography and themes.** C1 font family, C2 size, C4 leading, C5
margins, C6 alignment + hyphenation, C3 bold, C7 orientation/ruler, D1 themes
(unify tokens), C8 scope rule.

**Epic 4 — Selection, dictionary, highlights, notes.** E1 long-press dictionary
card (+ bundled offline dictionary), E2 selection menu, E3 handles, F1 colors,
F2 notes, F3 correctness rules (port from v1), F4 notebook + Logseq export, F5
deep links.

**Epic 5 — Navigation and chrome.** H1 Go To panel, G1/G2 bookmarks (synced),
H2 footnote popovers, H3 internal-link back, H5 improved in-book search, H4 Page
Flip peek, I1–I3 chrome bars, J1 instant resume wiring, J2 cross-device
continuity.

Epics 1–3 are the "can I actually read a book comfortably" core and should land
first. Epic 4 is the annotation layer. Epic 5 is navigation depth, with Page
Flip (H4) as the most involved single item.
