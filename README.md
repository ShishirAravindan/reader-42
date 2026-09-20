# reader-42

A library, over a folder that [KOReader](https://koreader.rocks/) owns.

KOReader does the reading. [Syncthing](https://syncthing.net/) makes the folder
the same folder on every device. reader-42 is what sits on either side of the
reading hour: the shelf you choose from, the record of what you have read, every
highlight in the collection in one place, and the off-ramp to Logseq.

It does not open books. Tapping one hands it to KOReader.

```sh
bun install
LIBRARY_DIR=/path/to/library KOREADER=/path/to/koreader.sh bun run shelf
```

The library is a plain folder with no index and no import step:

```
<library>/
  The Yellow Wallpaper.epub
  The Yellow Wallpaper.sdr/metadata.epub.lua   # written by the device
  Emma.epub                                    # never opened; still on the shelf
```

A book is on the shelf because the file is there. Everything known about it —
progress, reading status, highlights, notes, chapter titles — is what the device
wrote. Delete this app and the library is untouched.

- Why this shape, what it costs, and what was measured: [`docs/koreader-poc.md`](docs/koreader-poc.md)
- Thesis and product laws: [`docs/vision.md`](docs/vision.md)
- Durable refusals: [`docs/non-goals.md`](docs/non-goals.md)
- Decision log: [`docs/decisions.md`](docs/decisions.md)
- Agent context: [`.claude/CLAUDE.md`](.claude/CLAUDE.md)

Branches: `main` is stable; development happens on `dev`.
