/**
 * Tests for verify-extract. We write small fixture files into tmp and feed
 * paths through the public function (it reads from disk by design — that's
 * what the agent calls).
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyExtract } from './verify-extract.ts';

function writeTmp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'verify-extract-'));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('verify-extract', () => {
  test('passes a healthy URL extract with anchors', () => {
    const html = `<article><h1>Title</h1><p>The quick brown fox jumps over the lazy dog. The body is plenty long, well past the paragraph minimum.</p><p>See <a href="https://example.com/x">link</a>.</p></article>`;
    const path = writeTmp('raw.html', html);
    const result = verifyExtract({ sourceType: 'url', rawPath: path });
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  test('fails on missing file', () => {
    const result = verifyExtract({
      sourceType: 'url',
      rawPath: '/no/such/file.html',
    });
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.id).toBe('verify-extract-missing');
  });

  test('fails on empty file', () => {
    const path = writeTmp('raw.html', '');
    const result = verifyExtract({ sourceType: 'url', rawPath: path });
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.id).toBe('verify-extract-empty');
  });

  test('fails URL extract with too little body text', () => {
    const path = writeTmp('raw.html', '<html><body><p>Hi</p></body></html>');
    const result = verifyExtract({ sourceType: 'url', rawPath: path });
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.type).toBe('extract-thin');
  });

  test('warns when URL extract has no anchors but enough text', () => {
    const html =
      '<article><p>A perfectly readable paragraph about the design of reading software, with no hyperlinks at all but plenty of words for the verifier to be content with the body length and proceed.</p></article>';
    const path = writeTmp('raw.html', html);
    const result = verifyExtract({ sourceType: 'url', rawPath: path });
    expect(result.status).toBe('warn');
    expect(result.findings[0]?.id).toBe('verify-extract-no-anchors');
  });

  test('fails PDF extract with too few words', () => {
    const path = writeTmp('raw.txt', 'just a few words here');
    const result = verifyExtract({ sourceType: 'pdf', rawPath: path });
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.type).toBe('extract-thin');
  });

  test('passes PDF extract with adequate word count', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const path = writeTmp('raw.txt', words);
    const result = verifyExtract({ sourceType: 'pdf', rawPath: path });
    expect(result.status).toBe('pass');
  });
});
