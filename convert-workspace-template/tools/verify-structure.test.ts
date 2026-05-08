/**
 * Tests for verify-structure. Writes a small structure.json fixture per case
 * and feeds the path through the public function.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyStructure } from './verify-structure.ts';

function writeStructure(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'verify-structure-'));
  const path = join(dir, 'structure.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

describe('verify-structure', () => {
  test('passes a healthy multi-chapter structure', () => {
    const path = writeStructure({
      source_type: 'pdf',
      chapters: [
        { title: 'Introduction', length: 1200 },
        { title: 'Methods', length: 4500 },
        { title: 'Results', length: 6000 },
        { title: 'Discussion', length: 3000 },
      ],
    });
    const result = verifyStructure(path);
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
  });

  test('fails on missing file', () => {
    const result = verifyStructure('/no/such/structure.json');
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.id).toBe('verify-structure-missing');
  });

  test('fails on empty chapters list', () => {
    const path = writeStructure({ chapters: [] });
    const result = verifyStructure(path);
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.id).toBe('verify-structure-no-chapters');
  });

  test('fails when chapter title is empty', () => {
    const path = writeStructure({
      chapters: [
        { title: 'Intro', length: 100 },
        { title: '', length: 100 },
      ],
    });
    const result = verifyStructure(path);
    expect(result.status).toBe('fail');
    expect(
      result.findings.find((f) => f.type === 'structure-bad-title'),
    ).toBeDefined();
  });

  test('warns on all-caps chapter title', () => {
    const path = writeStructure({
      chapters: [
        { title: 'CHAPTER ONE', length: 1000 },
        { title: 'Chapter Two', length: 1000 },
      ],
    });
    const result = verifyStructure(path);
    expect(result.status).toBe('warn');
    expect(
      result.findings.some((f) => f.id.includes('allcaps')),
    ).toBe(true);
  });

  test('warns on dominant-chapter pattern', () => {
    const path = writeStructure({
      chapters: [
        { title: 'Chapter 1', length: 0 },
        { title: 'Chapter 2', length: 50000 },
        { title: 'Chapter 3', length: 100 },
      ],
    });
    const result = verifyStructure(path);
    expect(result.status).toBe('warn');
    expect(
      result.findings.some((f) => f.type === 'structure-dominant-chapter'),
    ).toBe(true);
  });

  test('fails when all chapter lengths are zero', () => {
    const path = writeStructure({
      chapters: [
        { title: 'A', length: 0 },
        { title: 'B', length: 0 },
      ],
    });
    const result = verifyStructure(path);
    expect(result.status).toBe('fail');
    expect(
      result.findings.some((f) => f.id === 'verify-structure-all-zero'),
    ).toBe(true);
  });

  test('fails on unparseable JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-structure-'));
    const path = join(dir, 'structure.json');
    writeFileSync(path, '{not json');
    const result = verifyStructure(path);
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.id).toBe('verify-structure-unparseable');
  });
});
