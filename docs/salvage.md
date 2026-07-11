# Salvage audit

The lessons inside the previous implementation, written down so the rewrite carries them without carrying the code. The code lives in git history; the tree at `d124d02` is the last commit that contains it, and file pointers below reference that tree. This file is scaffolding for the rewrite; delete it once the rewrite ships.

Everything here is stack-agnostic. It is what the problem domain taught, not what the current tools imposed.

## 1. The locator family

One design underpins positions, bookmarks, and highlights: element-index paths from the chapter wrapper down to a boundary element, plus a ratio (positions: how far into the element the viewport sits) or character offsets (highlights: offsets into the element's flattened text). Locators are mode-independent and axis-independent: captured against vertical scroll, they resolve against horizontal pages, and vice versa. This single idea is what makes mode switches, font-size changes, cross-device resume, and highlight deep links all work. Carry the design wholesale (`apps/web/src/reader/renderer.ts`).

Subtleties that each cost a real bug:

- **Overlay marks must be invisible to locators.** Highlight and find `<mark>` wrappers mutate the DOM. Paths must be computed against mark-free structure (see `structuralChildren` / `isOverlayMark`), and serialization must climb out of marks to the nearest structural element. Otherwise the second highlight in an already-marked paragraph serializes against the mutated tree and never resolves after reload.
- **The viewport top can land in a margin gap between blocks.** Anchor to the nearest following element with a negative ratio, or past the last block with ratio above 1; clamp to [0, 1] on restore so cross-axis overshoot stays inside the element.
- **Keep a raw scroll offset as fallback** for when no anchor resolves.
- **Highlight application must wrap each intersecting text node separately.** A single `surroundContents` throws as soon as the range crosses an element boundary. Skip unwrappable segments rather than failing the whole highlight; removal unwraps every segment and calls `normalize()` so text nodes re-fuse.
- **Selections inside shadow DOM are engine-specific.** Chromium exposes them via `shadowRoot.getSelection()`; elsewhere use the document selection and verify containment.
- **Sanitize persisted locators at load** (integer path steps, finite clamped ratio). Old or foreign data must degrade to "top of chapter", never to a crash.

## 2. Rendering traps

- **Adopt, don't clone.** Draining `body.firstChild` with `importNode` never terminates because the source keeps its children; `adoptNode` detaches and makes progress. This was an infinite render loop in production.
- **Never resolve geometry against a hidden viewport.** `getBoundingClientRect` on `display:none` returns zeros and anchors resolve to garbage. Ensure layout is live before any locator math.
- **Paged mode is CSS columns, and the columns must overflow the host horizontally** so the scroll container gains `scrollWidth`. A shadow-host clip kills pagination silently (zero pages, no error).
- **Page geometry:** column stride must equal the visible width (column + gap = clientWidth) with the wrapper's side padding folded into the gap. Cap the column at the text measure so a wide window reads like a page; the surplus becomes symmetric margins.
- **Shadow DOM sandboxing works.** Book CSS cannot leak out; the host theme flows in via CSS custom properties on `:host`. The book's own stylesheets get inlined into the shadow root with their `url()`s rewritten.
- **Resource rewriting:** every in-archive URL (img src, svg image xlink:href, source/audio/video src, CSS url()) becomes a blob URL, revoked on dispose. `<script>` is stripped. External links get `target=_blank` + `noopener`; internal links are intercepted by the UI layer.
- **Parse chapters as `application/xhtml+xml` first, fall back to `text/html` on parsererror.** Namespace-aware lookup everywhere: an XHTML document may have no `doc.body`, so fall through `getElementsByTagNameNS` with the XHTML namespace.
- **Read the display mode at call time,** not at closure creation, so a mode switch between capture (old layout) and restore (new layout) does the right thing on each side.

## 3. EPUB reality

- **The format is small enough to own.** A zip reader (central directory, stored + deflate via `DecompressionStream`, no ZIP64) plus container.xml, OPF (manifest, spine, metadata), and nav parsing with NCX fallback totals about 550 lines (`apps/web/src/epub/`).
- **Wild EPUBs deviate reliably:** chapters are XHTML or HTML; `epub:type` is sometimes unprefixed; hrefs arrive URI-encoded (decodeURI before resolving); every path resolves relative to its referencing file (container, OPF, nav, and chapter each have their own base); `linear="no"` spine items are skipped; the spine's `toc` attribute may point at a missing NCX.
- **Metadata is best-effort:** dc:title/dc:creator with filename fallback. Text extraction failures must not fail import; a book you can't search is better than a book you can't add.

## 4. Behaviors real use demanded

The ranked friction list from actually reading a book (PR #19). The rewrite treats these as day-one requirements, not discoveries:

- **Position follows the reader.** `{chapter, scroll, anchor}` persists with progress wherever the library lives; a fresh device opens the book where you left off. Typography and theme prefs stay device-local. Taste is device-local, place is not.
- **Import dedupes by content hash** (sha256), returning the existing book instead of a twin.
- **The end of the last chapter reports progress 1** and nudges the finished state; sitting at the end and reporting 0 was the single most jarring bug.
- **Browser Back returns to the shelf** (routing must be real, even in a single-page reader).
- **Keyboard reading in scroll mode:** Space, arrows, PageUp/Down. PageDown resetting to top was a filed friction.
- **Chrome show/hide must be conservative:** taps and clicks restore, only an explicit control hides, Escape only ever restores or closes.
- **Deep links** (`#/book/:id/hl/:hid`) must stay copyable from the address bar.

## 5. Data model

Three kinds of data carried the whole product (`apps/server/src/db/schema.ts`): item metadata and state (title, author, state, progress, position, content hash, timestamps), highlights (chapter, boundary paths and offsets, text, note), and reading sessions (seconds, endedAt; append-only). In the rewrite these map onto the file layout (`book.json` sidecars plus `library.json`; see `decisions.md`) rather than tables. Two lessons transfer regardless of storage: position is a JSON structure validated at every boundary it crosses, and the full-text index earned its keep twice (search, and chapter titles for exports) but is derived data, rebuildable from the books, never a source of truth. The Logseq export is one markdown outline per book: highlight text, chapter title (never spine indices), deep link, optional note.

## 6. Verification pattern

The demo/capture script is the acceptance test. It drives the real UI against the real storage and asserts load-bearing behavior (position restore, mode-switch invariance, highlight persistence) before taking frames. The three worst rendering bugs (sections above) were caught only this way; typecheck and unit tests missed all of them. The storage layer is cheap to test conventionally (import, dedupe, position round-trip, export were all covered). Keep both layers.

## 7. What to do differently

Honest debts, listed so the rewrite doesn't inherit them by momentum:

- **The UI layer needs real module boundaries.** The renderer's contract stayed clean (one interface, ~20 methods), but the controller above it grew into a single 1,000-line class plus a 550-line boot file; find, bookmarks, highlights, TOC, and chrome all landed in one place.
- **One-chapter-at-a-time rendering is simple and robust, but it makes chapter boundaries hard breaks.** Continuous scroll across chapters, book-wide page numbers, and the book map all fight this model. Decide the rendering unit deliberately.
- **State ownership is split without a rule.** Prefs and bookmarks live in localStorage, position lives in both localStorage and the server. Bookmarks therefore don't follow you across devices. Pick a single source of truth per datum.
- **Progress is chapter-count weighted:** (chapter index + in-chapter fraction) / chapter count. Chapters vary wildly in length, so the percentage lies. Length-weighted progress (character counts already exist in the FTS index) is more honest and is the substrate for time-left features.
- **In-book find matches within single text nodes only,** so phrases spanning inline tags are missed, and only the first occurrence per chapter is markable.
- **Theme tokens are duplicated** between the shadow CSS and the app stylesheet, with a "change them together" comment as the only guard.
- **There is no offline story.** The PWA label is aspirational; no service worker exists. The instant-resume product law needs one designed in, not bolted on.
