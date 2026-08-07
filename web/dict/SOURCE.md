# en-dict.json.gz — provenance and terms

## What it is

`en-dict.json.gz` is a gzipped JSON object mapping a lowercase headword to a
single trimmed definition: `{"paradox": "A tenet or proposition contrary to…"}`.
102,217 entries, 5.3 MB compressed, ~13 MB raw.

## Where it comes from

The text is **Webster's Unabridged Dictionary (1913)**, which is public domain
in the United States — it is the standard free English dictionary corpus for
exactly this reason.

The JSON repackaging is
[matthewreagan/WebstersEnglishDictionary](https://github.com/matthewreagan/WebstersEnglishDictionary)
(`dictionary_compact.json`).

Definitions are truncated to 320 characters at a sentence boundary by the build
script; no other transformation is applied beyond lowercasing the keys.

## Terms — unresolved, and the owner's to settle

This section previously said the repackaging is MIT-licensed. **It is not.**
The upstream repository carries no `LICENSE` file, and its README says:

> The original dictionary text file is covered by The Gutenberg Project's
> licensing, please see the file headers for more details. The Swift parsing
> tool and example output files in this repository are free and distributed
> under the GNU General Public License, Version 2.

`dictionary_compact.json` is one of those "example output files". So the two
readings that matter are:

1. The bytes we ship are a mechanical repackaging of public-domain text, and a
   mechanical repackaging attracts no new copyright, so nothing but the
   Gutenberg text's own public-domain status applies.
2. The upstream author's GPL-2 statement covers the JSON files as distributed,
   and shipping a derivative of them puts GPL-2 obligations on this repository.

Which one governs is a load-bearing call, not an implementation detail, so it
is recorded here as an open question rather than answered by an agent. Until it
is settled, no license notice ships beside the artifact — writing an MIT notice
that names a license the upstream never granted would be worse than the gap it
fills. Compare `web/fonts/licenses/OFL-*.txt`, where the upstream terms are
unambiguous and the notice ships verbatim.

Ways out, if reading 2 is the one the owner lands on: rebuild the artifact
directly from [Project Gutenberg ebook 29765](https://www.gutenberg.org/ebooks/29765)
(public domain text, PG header stripped, no intermediate repackaging), or
accept GPL-2 for the repository and ship its full text here.

## Rebuilding it

```
bun scripts/dict/build-dictionary.ts
```

The script fetches the source, applies the same trimming, and writes the
artifact. The output is deterministic given the same source revision.

## Why it is committed rather than fetched

Reading must work with no network. A dictionary that only resolves online is a
dictionary that fails in the moment it is wanted — on a plane, on a train, in a
basement. The cost is accepted deliberately: 5.3 MB in every clone, forever, and
it cannot be undone by reverting the feature.

The artifact is **not** in the service worker's precache list. It is fetched on
the first lookup only and then held in a runtime cache (`sw.js`), so the app
installs without it and pays the download only if the reader uses the feature.
