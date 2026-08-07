import { describe, expect, test } from 'bun:test';
import { bookDir, bookIdFromBytes, newRecordId, slugify } from './identity.ts';

describe('bookIdFromBytes', () => {
  test('deterministic 12-char hex id', async () => {
    const bytes = new TextEncoder().encode('the same epub bytes');
    const a = await bookIdFromBytes(bytes);
    const b = await bookIdFromBytes(new TextEncoder().encode('the same epub bytes'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  test('different bytes, different id', async () => {
    const a = await bookIdFromBytes(new TextEncoder().encode('book one'));
    const b = await bookIdFromBytes(new TextEncoder().encode('book two'));
    expect(a).not.toBe(b);
  });
});

describe('slugify', () => {
  test('lowercases, strips diacritics and punctuation', () => {
    expect(slugify('Éducation Sentimentale: A Novel!')).toBe('education-sentimentale-a-novel');
  });

  test('caps length without trailing hyphen', () => {
    const slug = slugify('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  test('degrades to untitled', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });
});

describe('bookDir', () => {
  test('slug plus id under books/', () => {
    expect(bookDir('The Dawn of Everything', 'abc123def456')).toBe(
      'books/the-dawn-of-everything-abc123def456',
    );
  });
});

describe('newRecordId', () => {
  test('8 hex chars: the one id shape highlights and bookmarks both use', () => {
    for (let i = 0; i < 50; i++) {
      expect(newRecordId()).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  test('and they do not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newRecordId()));
    expect(seen.size).toBe(200);
  });
});
