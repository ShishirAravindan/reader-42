/**
 * Tests for run-epubcheck. We don't ship a real EPUB fixture (binary, >100KB
 * concerns); instead we inject a runner so we can exercise the parsing and
 * mapping logic deterministically. The "missing CLI" case is covered by
 * simulating an ENOENT error from the runner.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEpubcheck, type SpawnLike } from './run-epubcheck.ts';

function tmpEpubPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'epubcheck-test-'));
  const path = join(dir, 'book.epub');
  // The file just has to exist; our runner is mocked so its contents don't
  // matter for these tests.
  writeFileSync(path, 'PK\x03\x04 stub');
  return path;
}

describe('run-epubcheck', () => {
  test('missing CLI is reported as skipped (does not block)', () => {
    const epub = tmpEpubPath();
    const fakeRunner = (): SpawnLike => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
    });
    const result = runEpubcheck(epub, { runner: fakeRunner });
    expect(result.status).toBe('skipped');
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f?.severity).toBe('warn');
    expect(f?.human_message).toContain('epubcheck');
    expect(f?.human_message).toContain("isn't installed");
  });

  test('valid epub (no messages) passes cleanly', () => {
    const epub = tmpEpubPath();
    const runner = (): SpawnLike => ({
      status: 0,
      stdout: JSON.stringify({ messages: [] }),
      stderr: '',
      error: null,
    });
    const result = runEpubcheck(epub, { runner });
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  test('warning-level epubcheck message becomes a warn finding', () => {
    const epub = tmpEpubPath();
    const runner = (): SpawnLike => ({
      status: 0,
      stdout: JSON.stringify({
        messages: [
          {
            ID: 'OPF-053',
            severity: 'WARNING',
            message: 'Date value is not in YYYY-MM-DD form.',
            locations: [{ path: 'OEBPS/content.opf', line: 12 }],
          },
        ],
      }),
      stderr: '',
      error: null,
    });
    const result = runEpubcheck(epub, { runner });
    expect(result.status).toBe('warn');
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f?.severity).toBe('warn');
    expect(f?.stage).toBe('assemble');
    expect(f?.human_message).toContain('OPF-053');
    expect(f?.human_message).toContain('Date value');
  });

  test('error-level epubcheck message produces a fail status', () => {
    const epub = tmpEpubPath();
    const runner = (): SpawnLike => ({
      status: 1,
      stdout: JSON.stringify({
        messages: [
          {
            ID: 'RSC-005',
            severity: 'ERROR',
            message: 'Resource missing referenced from spine.',
            locations: [{ path: 'OEBPS/missing.xhtml' }],
          },
        ],
      }),
      stderr: '',
      error: null,
    });
    const result = runEpubcheck(epub, { runner });
    expect(result.status).toBe('fail');
    const f = result.findings[0];
    expect(f?.severity).toBe('fail');
    expect(f?.type).toBe('epubcheck');
  });

  test('missing input epub fails fast', () => {
    const result = runEpubcheck('/no/such/file.epub');
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.id).toBe('run-epubcheck-missing-input');
  });
});
