import { describe, expect, test } from 'bun:test';
import { fixtureBytes } from './setup.ts';

import { InvalidEpubError, readEpubMeta } from '../src/epub-meta.ts';

describe('readEpubMeta', () => {
  test('extracts title and author from a real EPUB', async () => {
    const meta = await readEpubMeta(fixtureBytes());
    expect(meta.title).toBe('The Test Volume');
    expect(meta.author).toBe('reader-42 fixtures');
  });

  test('rejects bytes that are not a zip archive', async () => {
    const bytes = new TextEncoder().encode('this is definitely not an epub');
    await expect(readEpubMeta(bytes)).rejects.toBeInstanceOf(InvalidEpubError);
  });

  test('rejects a zip missing the EPUB container', async () => {
    // Take the real fixture and corrupt the container path so lookup fails.
    const text = new TextDecoder('latin1').decode(fixtureBytes());
    const corrupted = text.replaceAll('META-INF/container.xml', 'META-INF/container.bad');
    const bytes = Uint8Array.from(corrupted, (ch) => ch.charCodeAt(0));
    await expect(readEpubMeta(bytes)).rejects.toBeInstanceOf(InvalidEpubError);
  });
});
