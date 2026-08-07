// Rebuilds web/dict/en-dict.json.gz from its public-domain source.
//
// The artifact is 5.3 MB of compressed JSON committed to the repository, which
// is a real cost and an irreversible one: every clone carries it forever. It is
// committed rather than fetched at runtime because the reader must work with no
// network (product law: reading never needs the network), and a lookup that
// fails offline is worse than no lookup. This script exists so the blob is
// reproducible and auditable rather than magic — run it and diff the result.
//
//   bun scripts/dict/build-dictionary.ts
//
// Source: Webster's Unabridged Dictionary (1913), public domain in the United
// States and long out of copyright. The JSON repackaging used here is
// matthewreagan/WebstersEnglishDictionary, whose terms are NOT settled — see
// web/dict/SOURCE.md, which records the open question and the ways out.

const SOURCE =
  'https://raw.githubusercontent.com/matthewreagan/WebstersEnglishDictionary/master/dictionary_compact.json';
const OUT = new URL('../../web/dict/en-dict.json.gz', import.meta.url).pathname;

/** Definitions are trimmed to a card's worth of text, cut at a sentence. */
const MAX_DEFINITION = 320;

function trim(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_DEFINITION) return flat;
  const stop = flat.lastIndexOf('. ', MAX_DEFINITION);
  return stop > 60 ? flat.slice(0, stop + 1) : `${flat.slice(0, MAX_DEFINITION - 3)}...`;
}

// curl rather than fetch: this runs behind corporate and agent HTTPS proxies
// where fetch's TLS handling is the thing that breaks, and a build script that
// only works on an unproxied machine is not a reproducible build script.
const download = Bun.spawnSync(['curl', '-sSL', '--fail', SOURCE]);
if (!download.success) {
  throw new Error(`dictionary source fetch failed: ${download.stderr.toString().trim()}`);
}
const raw = JSON.parse(download.stdout.toString()) as Record<string, string>;

const entries: Record<string, string> = {};
for (const [word, definition] of Object.entries(raw)) {
  if (!definition.trim()) continue;
  entries[word.toLowerCase()] = trim(definition);
}

const json = new TextEncoder().encode(JSON.stringify(entries));
const gzipped = Bun.gzipSync(json, { level: 9 });
await Bun.write(OUT, gzipped);

console.log(
  `${Object.keys(entries).length} entries — ${(json.byteLength / 1e6).toFixed(1)} MB raw, ` +
    `${(gzipped.byteLength / 1e6).toFixed(1)} MB gzipped → ${OUT}`,
);
