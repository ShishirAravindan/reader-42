import { describe, expect, test } from 'bun:test';
import {
  FOOTNOTE_TEXT_CAP,
  NS_EPUB_OPS,
  epubType,
  isFootnoteRef,
  isNoteMarkerText,
} from './footnotes.ts';

function ctx(over: Partial<Parameters<typeof isFootnoteRef>[0]> = {}) {
  return {
    linkType: '',
    linkText: '1',
    targetTag: 'p',
    targetType: '',
    targetTextLength: 80,
    ...over,
  };
}

describe('epubType', () => {
  test('reads the ops namespace and the literal prefix alike (wild files)', () => {
    const doc = new DOMParser().parseFromString('<body><a/><b/></body>', 'text/html');
    const a = doc.querySelector('a') as Element;
    a.setAttributeNS(NS_EPUB_OPS, 'epub:type', 'noteref');
    expect(epubType(a)).toBe('noteref');
    const b = doc.querySelector('b') as Element;
    b.setAttribute('epub:type', 'footnote');
    expect(epubType(b)).toBe('footnote');
    expect(epubType(doc.createElement('i'))).toBe('');
  });
});

describe('isNoteMarkerText', () => {
  test('superscript-shaped markers', () => {
    for (const marker of ['1', '17', '[3]', '(4)', '*', '†', '‡‡']) {
      expect(isNoteMarkerText(marker)).toBe(true);
    }
  });

  test('ordinary link text is not a marker', () => {
    for (const text of ['', 'the end', 'chapter 3', '2001: a long title', '12345678']) {
      expect(isNoteMarkerText(text)).toBe(false);
    }
  });
});

describe('isFootnoteRef', () => {
  test('an explicit noteref link is a footnote whatever it points at', () => {
    expect(isFootnoteRef(ctx({ linkType: 'noteref', linkText: 'see the note' }))).toBe(true);
    // Even a long note: the publisher said what this link is.
    expect(isFootnoteRef(ctx({ linkType: 'noteref', targetTextLength: 5000 }))).toBe(true);
  });

  test('a target that declares itself a note pops up', () => {
    for (const type of ['footnote', 'endnote', 'rearnote', 'backmatter footnote']) {
      expect(isFootnoteRef(ctx({ linkText: 'see', targetType: type }))).toBe(true);
    }
  });

  test('a short aside target pops up', () => {
    expect(isFootnoteRef(ctx({ linkText: 'sidebar', targetTag: 'aside' }))).toBe(true);
  });

  test('the superscript heuristic needs BOTH a marker and a short target', () => {
    expect(isFootnoteRef(ctx({ linkText: '3', targetTextLength: 120 }))).toBe(true);
    expect(isFootnoteRef(ctx({ linkText: '3', targetTextLength: FOOTNOTE_TEXT_CAP + 1 }))).toBe(
      false,
    );
    expect(isFootnoteRef(ctx({ linkText: 'Chapter Three', targetTextLength: 120 }))).toBe(false);
  });

  test('an empty target never pops up: a blank popover is worse than the jump', () => {
    expect(isFootnoteRef(ctx({ linkType: 'noteref', targetTextLength: 0 }))).toBe(false);
    expect(isFootnoteRef(ctx({ targetTag: 'aside', targetTextLength: 0 }))).toBe(false);
  });
});
