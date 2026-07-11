# Vision

reader-42 is an instrument of environment design: it makes deliberate reading the path of least resistance, displacing algorithmic slop (reels, feeds, generic internet). It is one piece of a decomposed information diet. Capture and conversion belong to [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub), ambient reading to NetNewsWire, graph thinking to Logseq. reader-42 owns book-length reading: an exceptional e-reader, a beautiful library, and thin plumbing into the rest of the ecosystem.

It is a personal tool built to a product standard. The architecture keeps packaging, self-hosting for others, and productization possible; the scope stays personal until a deliberate decision says otherwise.

## Product laws

Every feature is judged against these. They outrank any feature list.

1. **Lower the cost of starting to read; raise the reward of having read.** The two levers of habit. A feature that does neither is decoration.
2. **Win the boredom moment.** The competitor is the first swipe of a feed. Opening reader-42 on any device resumes the current book, at the current position, in under a second. No home screen, no shelf, no decisions. The library is navigated back to, never through.
3. **Friction asymmetry.** Deliberate friction to get into the library (import is an act of intent, the on-deck queue is capped), near-zero friction to resume. Never invert this.
4. **Guided by beauty.** The library and the reading surface are aesthetic objects. When in doubt between adequate and beautiful, choose beautiful. When a feature can't be made beautiful, question the feature.
5. **The phone is a first-class reading surface.** The habit-displacement moment happens standing in line with a phone. Excellence on a phone screen is a requirement, not a port.

## The core: an exceptional e-reader

The bare minimum first step, and the hardest: a from-scratch EPUB reading experience that takes the gold standard of e-reading and improves it.

- Scroll and paginated modes. Positions are structural and mode-independent (spine item, element path, offset; never pixels), so bookmarks, progress, and highlight deep links survive mode switches and typography changes.
- Typography that rewards attention: real font control, measure, leading, margins, themes (light / sepia / dark), hyphenation and justification done properly.
- Instant resume as an engineering budget, not an aspiration: the current book cached and renderable in under a second on every device that has opened it.
- Re-orientation at zero cost: a subtle marker on the last-read paragraph, so resuming never means re-finding your line.
- A wind-down posture: evening warmth, a reading ritual at the owner's habitual hour. Gentle, never gamified.

## The library: a beautiful place

A record of engagement, not a queue and not a mall.

- A shelf that is genuinely beautiful: covers everywhere, with generated typographic covers for books that arrive without art.
- **On deck**: a deliberately capped next-up queue (3 to 5). The cap is the friction; it keeps the library a record rather than an inbox.
- States: *unread → reading → finished | DNF*. Honest, flat, minimal.
- Search across everything: full text, highlights, notes. "Where did I read about X?"

## Multi-device

The promise: your place is always right, on any device, instantly. Served from the owner's machine, readable from phone, tablet, and laptop. Offline-first for the current book and the on-deck queue is the ambition, as an explicit architecture decision rather than an accident. Remote access is a network-layer concern (e.g. Tailscale) unless a deliberate decision changes that.

## Modularity: API-first

The server is a documented API; the web reader is its first client. Highlights, library, positions, and stats are fetchable by anything the owner runs, including coding agents, via plain endpoints plus a written skill describing how to query them. Deliberately not an MCP server: endpoints and a skill deliver the same capability without reinventing plumbing. Highlights flow out to Logseq as thin pointers; the graph work happens there.

## Now, next, later

One ordered view; this section is the roadmap and the pipeline. Promotion between tiers is a deliberate act (a [`decisions.md`](decisions.md) entry when load-bearing), never drift. The durable refusals live in [`non-goals.md`](non-goals.md).

**Now**: the exceptional reader core, the boredom-moment features (instant resume, phone-first, zero-cost re-orientation), and the beautiful library basics (covers, on-deck, states).

**Next**, believed in but deliberately not yet:

- *Sense of place*: the book map (a zoomed-out minimap of the whole book: chapters as blocks, highlights as tick marks, position as a cursor; candidate signature UI), time left in chapter computed from measured pace, footnote popovers, offline dictionary and Wikipedia lookup on long-press.
- *Reward loop*: the finishing ritual (a closing page with highlights in sequence, time in the book, and a three-sentence verdict), the per-book afterpage kept forever, reading-log stats (heatmap, hours per week, pace, finish forecasts), a weekly digest, an annual reading wrapped.
- *Ecosystem plumbing*: a programmatic import endpoint (reflow-to-epub deposits directly; the on-deck cap preserves the anti-inbox spirit), webhooks on events (book finished, highlight created), the agent query skill companion to the API.

**Later**: TTS read-aloud with position sync (expands the habit into commutes), productization proper (packaging, install story, docs for strangers; multi-user or hosted only via a deliberate decision entry), cover-art enrichment, series grouping, and OPDS if dogfooding demands them.
