# Non-goals

What reader-42 is deliberately *not*. The refusals shape the product more than the features do.

- **Not a capture or conversion tool.** URL/PDF → EPUB is [reflow-to-epub](https://github.com/ShishirAravindan/reflow-to-epub)'s entire job. reader-42 consumes finished EPUBs via manual import; no fetching, extraction, or conversion pipeline lives here.
- **Not an RSS reader.** NetNewsWire owns that.
- **Not a knowledge graph or notes app.** Logseq owns that. Highlights flow *out* to the PKM as thin pointers; the smart graph work happens there.
- **Not a cloud-synced service.** No hosted backend (Convex, Supabase, etc.), no accounts, no sync layer. The library is a SQLite file on the user's machine; other devices read over the LAN. Remote access, if ever needed, is a network-layer problem (Tailscale), not an architecture change.
- **Not a social or shared-reading product.** Single user, private library, no sharing.
- **Not a Pocket-style firehose / read-later inbox.** Import is a deliberate, manual act — that friction is calibrated to keep the library a record, not a queue.
- **Not a Calibre-style power-user library manager.** Library view is intentionally minimal.
- **Not a research-paper / academic-PDF viewer.** Out of scope unless explicitly added later.
- **Not a multi-format bookshelf.** EPUB is the substrate. Other formats (mobi, AZW3, etc.) are not goals.
