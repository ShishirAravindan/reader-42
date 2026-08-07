// The offline dictionary (parity E1): a bundled Webster 1913 (public domain,
// ~102k entries) shipped as web/dict/en-dict.json.gz — `{ word: definition }`
// with lowercase keys. Loaded LAZILY on the first lookup, never at book open:
// the 5 MB fetch must not sit between the reader and their book. Once loaded
// the Map stays resident, so every later lookup is instant and offline; the
// service worker's runtime cache makes the artifact itself offline after the
// first fetch.

export type DictState = 'idle' | 'loading' | 'ready' | 'failed';

export interface DictEntry {
  /** The matched headword — may differ from the query when folding matched. */
  headword: string;
  definition: string;
}

export interface Dictionary {
  lookup(term: string): Promise<DictEntry | null>;
  state(): DictState;
}

/**
 * Candidate headwords for a term, most-literal first: normalized exact form,
 * then plural folds (-s, -es, ies→y), then -ed/-ing with dropped-e restore
 * (taking→take) and consonant undoubling (travelling→travel), then ll→l.
 * The first candidate present in the dictionary wins.
 *
 * Order inside the -ed/-ing fold is load-bearing. The dropped-e restore comes
 * BEFORE the bare stem, because English drops that e far more often than it
 * leaves a real word behind: with the bare stem first, "caring" resolves to
 * `car` ("a small vehicle moved on wheels"), "used" to `us`, "hoped" to `hop`.
 * Every one of those shorter headwords exists, so nothing downstream can tell
 * the wrong answer from the right one — the order is the whole decision.
 */
export function foldCandidates(term: string): string[] {
  let w = term.toLowerCase().trim();
  // Surrounding punctuation and quotes, then the possessive.
  w = w.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
  w = w.replace(/['’]s$/u, '');
  if (!w) return [];

  const out: string[] = [w];
  const push = (candidate: string): void => {
    if (candidate.length >= 2 && !out.includes(candidate)) out.push(candidate);
  };

  if (w.endsWith('s')) push(w.slice(0, -1));
  if (w.endsWith('es')) push(w.slice(0, -2));
  if (w.endsWith('ies')) push(`${w.slice(0, -3)}y`);
  for (const suffix of ['ed', 'ing'] as const) {
    if (!w.endsWith(suffix) || w.length <= suffix.length + 1) continue;
    const base = w.slice(0, -suffix.length);
    push(`${base}e`); // taking -> take, judged -> judge, caring -> care
    push(base);
    if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
      push(base.slice(0, -1)); // travelling -> travel, stopped -> stop
    }
  }
  if (w.endsWith('ll')) push(w.slice(0, -1));
  return out;
}

/** The normalized form of a query (what "exact" means); '' when nothing left. */
export function normalizeTerm(term: string): string {
  return foldCandidates(term)[0] ?? '';
}

export function createDictionary(fetchBytes: () => Promise<Uint8Array>): Dictionary {
  let state: DictState = 'idle';
  let entries: Map<string, string> | null = null;
  let loading: Promise<Map<string, string> | null> | null = null;

  function load(): Promise<Map<string, string> | null> {
    if (entries) return Promise.resolve(entries);
    if (!loading) {
      state = 'loading';
      loading = (async (): Promise<Map<string, string> | null> => {
        try {
          const bytes = await fetchBytes();
          const parsed = JSON.parse(await gunzipToText(bytes)) as Record<string, string>;
          entries = new Map(Object.entries(parsed));
          state = 'ready';
          return entries;
        } catch {
          state = 'failed';
          loading = null; // a later lookup may retry (e.g. network returned)
          return null;
        }
      })();
    }
    return loading;
  }

  return {
    state: (): DictState => state,
    async lookup(term: string): Promise<DictEntry | null> {
      const dict = await load();
      if (!dict) return null;
      const find = (t: string): DictEntry | null => {
        for (const candidate of foldCandidates(t)) {
          const definition = dict.get(candidate);
          if (definition !== undefined) return { headword: candidate, definition };
        }
        return null;
      };
      const direct = find(term);
      if (direct) return direct;
      // A phrase that missed: fall back to its first word.
      const first = term.trim().split(/\s+/)[0] ?? '';
      return first && first !== term.trim() ? find(first) : null;
    },
  };
}

/**
 * The artifact is a .gz, but whether it arrives compressed is the host's
 * business, not ours: a static host that serves `.gz` with
 * `Content-Encoding: gzip` has the browser inflate it before the fetch
 * resolves, and handing already-JSON bytes to DecompressionStream throws —
 * which the card reports as "could not be loaded" forever. So sniff the two
 * magic bytes and decompress only what is actually gzip.
 */
async function gunzipToText(bytes: Uint8Array): Promise<string> {
  const blob = new Blob([bytes.slice()]);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return await new Response(blob).text();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}
