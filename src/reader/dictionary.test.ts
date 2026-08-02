import { describe, expect, test } from 'bun:test';
import { type DictEntry, createDictionary, foldCandidates, normalizeTerm } from './dictionary.ts';

/** Assert the CHOSEN headword, not membership: which one wins is the bug. */
function expectHeadword(entry: DictEntry | null, headword: string): void {
  expect(entry?.headword).toBe(headword);
}

describe('foldCandidates', () => {
  test('normalizes case, surrounding punctuation, and possessives first', () => {
    expect(foldCandidates('Fox')[0]).toBe('fox');
    expect(foldCandidates('“quick,”')[0]).toBe('quick');
    expect(foldCandidates("the fox's".slice(4))[0]).toBe('fox');
    expect(foldCandidates('dogs’')[0]).toBe('dogs');
  });

  test('plural folds: -s, -es, ies→y', () => {
    expect(foldCandidates('jumps')).toContain('jump');
    expect(foldCandidates('boxes')).toContain('box');
    expect(foldCandidates('ladies')).toContain('lady');
  });

  test('-ing folds restore a dropped e and undouble consonants', () => {
    expect(foldCandidates('taking')).toContain('take');
    expect(foldCandidates('travelling')).toContain('travel');
    expect(foldCandidates('reading')).toContain('read');
  });

  test('-ed folds mirror -ing', () => {
    expect(foldCandidates('judged')).toContain('judge');
    expect(foldCandidates('stopped')).toContain('stop');
    expect(foldCandidates('walked')).toContain('walk');
  });

  // Membership is not enough: both candidates are real headwords in a real
  // dictionary, so whichever comes FIRST is the definition the reader gets.
  test('the dropped-e restore is tried before the bare stem', () => {
    const order = (word: string, a: string, b: string): void => {
      const list = foldCandidates(word);
      expect(list.indexOf(a)).toBeGreaterThan(-1);
      expect(list.indexOf(b)).toBeGreaterThan(-1);
      expect(list.indexOf(a)).toBeLessThan(list.indexOf(b));
    };
    order('caring', 'care', 'car');
    order('hoped', 'hope', 'hop');
    order('used', 'use', 'us');
    order('piped', 'pipe', 'pip');
  });

  test('ll→l', () => {
    expect(foldCandidates('fulfill')).toContain('fulfil');
  });

  test('the exact form always comes first', () => {
    expect(foldCandidates('Species')[0]).toBe('species');
    expect(foldCandidates('quick')).toEqual(['quick']);
  });

  test('degenerate input yields nothing', () => {
    expect(foldCandidates('…—!')).toEqual([]);
    expect(foldCandidates('')).toEqual([]);
  });

  test('normalizeTerm is the exact form', () => {
    expect(normalizeTerm('“Jumps!”')).toBe('jumps');
    expect(normalizeTerm('!!')).toBe('');
  });
});

const FIXTURE: Record<string, string> = {
  quick: 'Alive; living; animate.',
  jump: 'To spring free from the ground.',
  travel: 'To journey.',
};

function gzipped(): Uint8Array {
  return Bun.gzipSync(new TextEncoder().encode(JSON.stringify(FIXTURE)));
}

describe('createDictionary', () => {
  test('lazy: nothing fetched until the first lookup, then exactly once', async () => {
    let fetches = 0;
    const dict = createDictionary(async () => {
      fetches += 1;
      return gzipped();
    });
    expect(dict.state()).toBe('idle');
    expect(fetches).toBe(0);

    expect(await dict.lookup('quick')).toEqual({
      headword: 'quick',
      definition: 'Alive; living; animate.',
    });
    expect(dict.state()).toBe('ready');
    expect(fetches).toBe(1);

    // The second lookup reuses the resident map: no re-fetch.
    expect((await dict.lookup('jump'))?.headword).toBe('jump');
    expect(fetches).toBe(1);
  });

  test('folded lookup returns the matched headword', async () => {
    const dict = createDictionary(async () => gzipped());
    expect((await dict.lookup('jumps'))?.headword).toBe('jump');
    expect((await dict.lookup('Travelling'))?.headword).toBe('travel');
  });

  test('a phrase that misses falls back to its first word', async () => {
    const dict = createDictionary(async () => gzipped());
    expect((await dict.lookup('quick brown fox'))?.headword).toBe('quick');
    expect(await dict.lookup('zzz yyy')).toBeNull();
  });

  test('a miss is null, not an error', async () => {
    const dict = createDictionary(async () => gzipped());
    expect(await dict.lookup('xylophone')).toBeNull();
  });

  // A real dictionary holds `car` AND `care`, `us` AND `use`. The fold order
  // decides which one the reader reads, and a `toContain` assertion cannot
  // see the difference — which is why double-clicking "caring" shipped "a
  // small vehicle moved on wheels".
  const COLLIDING: Record<string, string> = {
    car: 'A small vehicle moved on wheels.',
    care: 'To be anxious or solicitous.',
    us: 'The objective case of we.',
    use: 'To make use of; to employ.',
    hop: 'To move by successive leaps.',
    hope: 'A desire of some good, with expectation of obtaining it.',
    pip: 'A seed, as of an apple.',
    pipe: 'A wind instrument of music.',
  };

  test('a colliding fold resolves to the headword the reader meant', async () => {
    const dict = createDictionary(async () =>
      Bun.gzipSync(new TextEncoder().encode(JSON.stringify(COLLIDING))),
    );
    expectHeadword(await dict.lookup('caring'), 'care');
    expectHeadword(await dict.lookup('used'), 'use');
    expectHeadword(await dict.lookup('hoped'), 'hope');
    expectHeadword(await dict.lookup('piped'), 'pipe');
    // ...and the bare stem still wins when it is the only word there is.
    expectHeadword(await dict.lookup('cars'), 'car');
  });

  // Static hosts serve .gz with Content-Encoding: gzip, which makes the
  // browser inflate before we ever see the bytes. Assuming gzip there throws,
  // and the card says "could not be loaded" forever.
  test('bytes that arrive already inflated are parsed, not decompressed', async () => {
    const dict = createDictionary(async () => new TextEncoder().encode(JSON.stringify(FIXTURE)));
    expectHeadword(await dict.lookup('quick'), 'quick');
    expect(dict.state()).toBe('ready');
  });

  test('a failed fetch degrades to null and allows a retry', async () => {
    let attempts = 0;
    const dict = createDictionary(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return gzipped();
    });
    expect(await dict.lookup('quick')).toBeNull();
    expect(dict.state()).toBe('failed');
    expect((await dict.lookup('quick'))?.headword).toBe('quick');
    expect(dict.state()).toBe('ready');
  });
});
