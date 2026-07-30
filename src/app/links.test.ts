import { describe, expect, test } from 'bun:test';
import { resolveHref } from './links.ts';

describe('resolveHref', () => {
  test('a sibling file resolves against the chapter’s own folder', () => {
    expect(resolveHref('OEBPS/text/ch01.xhtml', 'ch02.xhtml')).toBe('OEBPS/text/ch02.xhtml');
  });

  test('“..” climbs out of the folder', () => {
    expect(resolveHref('OEBPS/text/ch01.xhtml', '../notes/notes.xhtml')).toBe(
      'OEBPS/notes/notes.xhtml',
    );
    expect(resolveHref('OEBPS/a/b/ch01.xhtml', '../../c/ch02.xhtml')).toBe('OEBPS/c/ch02.xhtml');
  });

  test('“.” and empty segments are noise', () => {
    expect(resolveHref('OEBPS/text/ch01.xhtml', './ch02.xhtml')).toBe('OEBPS/text/ch02.xhtml');
    expect(resolveHref('OEBPS/text/ch01.xhtml', 'sub//ch02.xhtml')).toBe(
      'OEBPS/text/sub/ch02.xhtml',
    );
  });

  test('a chapter at the archive root has no folder to resolve against', () => {
    expect(resolveHref('ch01.xhtml', 'ch02.xhtml')).toBe('ch02.xhtml');
  });

  test('climbing past the root simply stops there', () => {
    expect(resolveHref('OEBPS/ch01.xhtml', '../../../ch02.xhtml')).toBe('ch02.xhtml');
  });

  test('the fragment is the caller’s business: only the path part arrives here', () => {
    // The caller splits on '#', so an empty path resolves to the chapter's folder.
    expect(resolveHref('OEBPS/text/ch01.xhtml', '')).toBe('OEBPS/text');
  });
});
