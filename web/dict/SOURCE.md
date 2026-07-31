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
(`dictionary_compact.json`), which is distributed under the **MIT License**.
Its own README states the dictionary data itself is public domain.

Definitions are truncated to 320 characters at a sentence boundary by the build
script; no other transformation is applied beyond lowercasing the keys.

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
