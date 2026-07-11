# Vision (v2)

reader-42 is an instrument of **environment design**: its job is to make deliberate reading the path of least resistance in its owner's life, displacing algorithmic slop (reels, feeds, generic internet). It is one piece of a decomposed information-diet system — capture/conversion belongs to [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub), ambient/RSS reading to NetNewsWire, graph thinking to Logseq. reader-42's piece is the **book-length reading experience**: an exceptional e-reader, a beautiful library, and thin plumbing into the rest of the ecosystem.

This is v2 of the vision, superseding the v1 telos (see [`decisions.md`](decisions.md), 2026-07-11 entries). The ambition is higher: not just a personal tool, but something built to a standard where productizing it — "Plex for books": self-hosted, beautiful, experience-first — remains a live option. Architecture must not foreclose that door; scope, for now, does not walk through it.

## Product laws

Every feature is judged against these. They outrank any feature list.

1. **Lower the cost of starting to read; raise the reward of having read.** The two levers of habit. A feature that does neither is decoration.
2. **Win the boredom moment.** The competitor is not Kindle; it is the first swipe of a feed. Opening reader-42 on any device resumes the current book, at the current position, in under a second — no home screen, no shelf, no decisions. The library is navigated *back* to, never through.
3. **Friction asymmetry.** Deliberate friction to get *into* the library (import is an act of intent; the on-deck queue is capped). Near-zero friction to *resume*. Never invert this.
4. **Guided by beauty.** The library and the reading surface are aesthetic objects. When in doubt between adequate and beautiful, choose beautiful; when a feature can't be made beautiful, question the feature.
5. **The phone is a first-class reading surface.** The habit-displacement moment happens standing in line with a phone. Excellence on a phone screen is a requirement, not a port.

## The core: an exceptional e-reader

The bare minimum first step, and the hardest: a from-scratch EPUB reading experience that beats Kindle where Kindle is weak.

- Scroll and paginated modes; positions are structural and mode-independent (v1's proven locator design carries forward).
- Typography that rewards attention: real font control, measure, leading, margins, themes (light / sepia / dark), hyphenation and justification done properly.
- Instant resume as an engineering budget, not an aspiration: current book cached and renderable in <1s on every device that has opened it.
- Re-orientation at zero cost: a subtle marker on the last-read paragraph so resuming never means re-finding your line.
- A wind-down posture: evening warmth, a reading ritual at the owner's habitual hour — gentle, never gamified.

## The library: a beautiful place

A record of engagement, not a queue and not a mall.

- A shelf that is genuinely beautiful: covers everywhere, with generated typographic covers for books that arrive without art.
- **On deck**: a deliberately capped next-up queue (3–5). The cap is the friction; it keeps the library a record rather than an inbox.
- States: *unread → reading → finished | DNF*. Honest, flat, minimal.
- Search across everything — full text, highlights, notes: "where did I read about X?"

## Multi-device

The promise: *your place is always right, on any device, instantly.* Served from the owner's machine, readable from phone/tablet/laptop; offline-first for the current book and on-deck queue is the ambition (an explicit architecture decision, not an accident). Remote access is a network-layer concern (e.g. Tailscale) until productization says otherwise.

## Modularity: API-first

The server is a documented API; the web reader is merely its first client. Highlights, library, positions, and stats are all fetchable by anything the owner runs — including coding agents, via **plain endpoints plus a written skill describing how to query them**. Deliberately not an MCP server: endpoints + a skill deliver the same capability without spending novelty budget on protocol plumbing. Highlights flow out to Logseq as thin pointers; the graph work happens there.

## Now, next, later

One ordered view — this section is the roadmap and the pipeline. Promotion between tiers is a deliberate act (a [`decisions.md`](decisions.md) entry when load-bearing), never drift. The durable refusals live in [`non-goals.md`](non-goals.md).

**Now** — the bare minimum first step: the exceptional reader core, the boredom-moment features (instant resume, phone-first, zero-cost re-orientation), and the beautiful library basics (covers, on-deck, states).

**Next** — ideas with a pulse, believed in but deliberately not yet:

- *Sense of place*: the book map (zoomed-out minimap — chapters as blocks, highlights as tick marks, position as cursor; candidate signature UI), time-left-in-chapter from measured pace, footnote/endnote popovers, offline dictionary / Wikipedia long-press lookup.
- *Reward loop*: the finishing ritual (closing page — highlights in sequence, time in book, a 3-sentence verdict), the per-book afterpage kept forever, reading-log stats (heatmap, hours/week, pace, finish forecasts), weekly digest, annual reading wrapped.
- *Ecosystem plumbing*: programmatic import endpoint (reflow-to-epub deposits directly; the on-deck cap preserves the anti-inbox spirit), webhooks on events (book finished, highlight created), the agent query skill companion to the API.

**Later** — TTS read-aloud with position sync (expands the habit into commutes), productization proper (packaging, install story, docs for strangers; multi-user/hosted only via a deliberate decision entry), cover-art enrichment / series grouping / OPDS if dogfooding demands them.
