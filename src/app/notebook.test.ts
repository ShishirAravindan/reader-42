import { describe, expect, test } from 'bun:test';
import type { Highlight } from '../library/types.ts';
import { chapterTitles, comparePaths, logseqOutline, sortHighlights } from './notebook.ts';

function hl(id: string, chapter: number, path: number[], offset: number): Highlight {
  return {
    id,
    chapter,
    start: { path, offset },
    end: { path, offset: offset + 5 },
    text: `text ${id}`,
    createdAt: '2026-07-20T10:00:00.000Z',
  };
}

describe('comparePaths', () => {
  test('lexicographic, ancestors before descendants', () => {
    expect(comparePaths([2], [3])).toBeLessThan(0);
    expect(comparePaths([2], [2, 1])).toBeLessThan(0);
    expect(comparePaths([2, 1], [2])).toBeGreaterThan(0);
    expect(comparePaths([2, 1], [2, 1])).toBe(0);
  });
});

describe('sortHighlights', () => {
  test('book order: chapter, then start path, then offset — never creation time', () => {
    const late = { ...hl('a-late', 0, [1], 0), createdAt: '2026-07-25T10:00:00.000Z' };
    const sorted = sortHighlights([
      hl('c', 2, [0], 0),
      hl('b2', 1, [4], 10),
      hl('b1', 1, [4], 2),
      hl('b0', 1, [2, 1], 0),
      late,
    ]);
    expect(sorted.map((h) => h.id)).toEqual(['a-late', 'b0', 'b1', 'b2', 'c']);
  });
});

describe('chapterTitles', () => {
  const toc = [
    { label: 'One', path: 'ch1.xhtml', children: [] },
    {
      label: 'Two',
      path: 'ch2.xhtml',
      children: [{ label: 'Deep in two', path: 'ch2.xhtml', children: [] }],
    },
    { label: 'Four', path: 'ch4.xhtml', children: [] },
  ];
  const spine = ['ch1.xhtml', 'ch2.xhtml', 'ch3.xhtml', 'ch4.xhtml'];
  const indexOf = (path: string): number => spine.indexOf(path);

  test("a chapter's own FIRST toc entry names it (not a same-file subsection)", () => {
    const titles = chapterTitles(toc, spine.length, indexOf);
    expect(titles[0]).toBe('One');
    expect(titles[1]).toBe('Two'); // not 'Deep in two'
    expect(titles[3]).toBe('Four');
  });

  test('a chapter with no entry is covered by the LAST entry before it', () => {
    const titles = chapterTitles(toc, spine.length, indexOf);
    expect(titles[2]).toBe('Deep in two'); // ch3 follows the section that started there
  });

  test('"last before it" means last in SPINE order, not last in toc order', () => {
    // Real books list front matter out of order: a trailing Copyright entry
    // pointing back at spine 1 must not name every untitled chapter after it.
    const outOfOrder = [
      { label: 'Cover', path: 'cover.xhtml', children: [] },
      { label: 'Chapter One', path: 'ch1.xhtml', children: [] },
      { label: 'Copyright', path: 'copy.xhtml', children: [] },
    ];
    const files = ['cover.xhtml', 'copy.xhtml', 'ch1.xhtml', 'ch1b.xhtml'];
    const titles = chapterTitles(outOfOrder, files.length, (p) => files.indexOf(p));
    expect(titles[3]).toBe('Chapter One'); // not 'Copyright' (spine 1)
  });

  test('no matching label falls back to "Chapter N", never a spine index', () => {
    expect(chapterTitles([], 2, () => -1)).toEqual(['Chapter 1', 'Chapter 2']);
    // A toc pointing at files missing from the spine is as good as none.
    const stray = [{ label: 'Ghost', path: 'nowhere.xhtml', children: [] }];
    expect(chapterTitles(stray, 1, indexOf)[0]).toBe('Chapter 1');
  });
});

describe('logseqOutline', () => {
  test('one outline per book: title, text, chapter, link, optional note', () => {
    const out = logseqOutline('A Book', [
      {
        text: 'first passage',
        chapterTitle: 'Two',
        link: 'https://r.example/#/book/abc/hl/11112222',
        note: 'a thought',
      },
      {
        text: 'second passage',
        chapterTitle: 'Three',
        link: 'https://r.example/#/book/abc/hl/33334444',
      },
    ]);
    expect(out).toBe(
      [
        '# A Book',
        '- first passage',
        '  - Two',
        '  - [link](https://r.example/#/book/abc/hl/11112222)',
        '  - note: a thought',
        '- second passage',
        '  - Three',
        '  - [link](https://r.example/#/book/abc/hl/33334444)',
        '',
      ].join('\n'),
    );
  });

  test('an empty book still exports a valid outline head', () => {
    expect(logseqOutline('Empty', [])).toBe('# Empty\n');
  });

  test('book syntax never becomes graph syntax: refs, emphasis, code, headings', () => {
    const out = logseqOutline('A # Book', [
      {
        text: 'he read [[Moby Dick]] in a *hurried* way, `code`_ish_ {{x}}',
        chapterTitle: '# One',
        link: 'https://r.example/#/book/abc/hl/1111',
      },
    ]);
    expect(out).toBe(
      [
        '# A \\# Book',
        '- he read \\[\\[Moby Dick\\]\\] in a \\*hurried\\* way, \\`code\\`\\_ish\\_ \\{\\{x\\}\\}',
        '  - \\# One',
        '  - [link](https://r.example/#/book/abc/hl/1111)',
        '',
      ].join('\n'),
    );
    // Nothing that would resolve as a page reference or a macro survives.
    expect(out).not.toContain('[[Moby');
    expect(out).not.toContain('{{x}}');
  });

  test('a multi-line note stays inside its own block', () => {
    const out = logseqOutline('B', [
      {
        text: 'passage',
        chapterTitle: 'One',
        link: 'l',
        note: 'point A\npoint B',
      },
      { text: 'after', chapterTitle: 'One', link: 'l2' },
    ]);
    expect(out).toBe(
      [
        '# B',
        '- passage',
        '  - One',
        '  - [link](l)',
        '  - note: point A',
        '    point B', // indented past the bullet: continuation, not a new block
        '- after',
        '  - One',
        '  - [link](l2)',
        '',
      ].join('\n'),
    );
    // No line of a note ever starts at column 0, which is what made every
    // later highlight a sibling of the book title.
    for (const line of out.split('\n').slice(1)) {
      if (line && !line.startsWith('- ')) expect(line.startsWith('  ')).toBe(true);
    }
  });

  test('a note line that looks like a bullet or a quote is escaped, not obeyed', () => {
    const out = logseqOutline('C', [
      {
        text: '- dash first',
        chapterTitle: 'One',
        link: 'l',
        note: 'first\n> quoted\n2. numbered',
      },
    ]);
    expect(out).toContain('- \\- dash first');
    expect(out).toContain('    \\> quoted');
    expect(out).toContain('    2\\. numbered');
  });

  test('blank lines in a note collapse rather than ending the block', () => {
    const out = logseqOutline('D', [
      { text: 't', chapterTitle: 'One', link: 'l', note: 'first\n\n  \n\nsecond' },
    ]);
    expect(out).toContain('  - note: first\n    second');
    expect(out).not.toContain('\n\n');
  });

  test('a windows-newline note does not leak a carriage return', () => {
    const out = logseqOutline('E', [{ text: 'a\r\nb', chapterTitle: 'One', link: 'l' }]);
    expect(out).not.toContain('\r');
    expect(out).toContain('- a\n  b');
  });
});
