import { describe, expect, test } from 'bun:test';
import { serializeRange } from '../reader/annotate.ts';
import { indexChapter, resolveAnnotation } from './resolve.ts';
import type { KoAnnotation } from './sdr.ts';

function wrapperOf(html: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'chapter';
  wrapper.innerHTML = html;
  return wrapper;
}

function annotation(text: string, spineHint: number | null = null): KoAnnotation {
  return {
    text,
    color: 'yellow',
    createdAt: '2026-09-12T21:04:11',
    spineHint,
    xpointer: null,
  };
}

/** serializeRange, narrowed: a null here means the test's own Range is wrong,
 * which is a broken test rather than a failed assertion. */
function serialized(wrapper: HTMLElement, range: Range) {
  const out = serializeRange(wrapper, range);
  if (!out) throw new Error('serializeRange returned null for the test range');
  return out;
}

/** Resolve `text` against a single-chapter book and return the boundaries. */
function resolveIn(wrapper: HTMLElement, text: string, spineHint: number | null = null) {
  const outcome = resolveAnnotation(annotation(text, spineHint), [indexChapter(wrapper)]);
  if (!outcome.ok) throw new Error(`did not resolve: ${outcome.why}`);
  return outcome.at;
}

// The whole PoC rests on this: boundaries recovered from a device's text must
// be the SAME numbers the reader would have written for a selection made here.
// If they diverge, an imported highlight renders in the wrong place — which is
// worse than not importing it at all.
describe('boundaries agree with what serializeRange would have produced', () => {
  test('a span inside one element', () => {
    const wrapper = wrapperOf('<p>Hello there, reader.</p>');
    const paragraph = wrapper.children[0] as HTMLElement;
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Text, 6);
    range.setEnd(paragraph.firstChild as Text, 19);

    const expected = serialized(wrapper, range);
    const at = resolveIn(wrapper, range.toString());
    expect(at.start).toEqual(expected.start);
    expect(at.end).toEqual(expected.end);
  });

  test('a span that crosses into a nested element', () => {
    const wrapper = wrapperOf('<p>It ends, as chapters do, <em>quietly</em>.</p>');
    const paragraph = wrapper.children[0] as HTMLElement;
    const em = paragraph.querySelector('em') as HTMLElement;
    const range = document.createRange();
    range.setStart(paragraph.firstChild as Text, 21);
    range.setEnd(em.firstChild as Text, 7);

    const expected = serialized(wrapper, range);
    const at = resolveIn(wrapper, range.toString());
    // The end boundary belongs to <em>, not to the paragraph: the two sides
    // have to agree about which element owns the last character.
    expect(at.start).toEqual(expected.start);
    expect(at.end).toEqual(expected.end);
  });

  test('a span that starts in a nested element', () => {
    const wrapper = wrapperOf('<p>Before <em>the middle</em> and after.</p>');
    const paragraph = wrapper.children[0] as HTMLElement;
    const em = paragraph.querySelector('em') as HTMLElement;
    const range = document.createRange();
    range.setStart(em.firstChild as Text, 4);
    range.setEnd(paragraph.lastChild as Text, 4);

    const expected = serialized(wrapper, range);
    const at = resolveIn(wrapper, range.toString());
    expect(at.start).toEqual(expected.start);
    expect(at.end).toEqual(expected.end);
  });

  // A selection made by hand can end on whitespace; a sidecar string never
  // does, because it has been flattened before it was written. So boundaries
  // recovered from text stop at the last non-space character, one short of
  // what a trailing-space Range would have serialized. Visually identical,
  // and pinned here so the difference stays a decision rather than a surprise.
  test('a trailing space is trimmed off the end boundary', () => {
    const wrapper = wrapperOf('<p>Before <em>the middle</em> and after.</p>');
    const paragraph = wrapper.children[0] as HTMLElement;
    const em = paragraph.querySelector('em') as HTMLElement;
    const range = document.createRange();
    range.setStart(em.firstChild as Text, 4);
    range.setEnd(paragraph.lastChild as Text, 5); // includes the space after "and"

    const expected = serialized(wrapper, range);
    const at = resolveIn(wrapper, range.toString());
    expect(at.start).toEqual(expected.start);
    expect(at.end.offset).toBe(expected.end.offset - 1);
  });
});

describe('matching real book text against real book markup', () => {
  test('indented, line-wrapped XHTML still matches a flat device string', () => {
    // A sidecar's text is one flat line; the source it came from is not.
    const wrapper = wrapperOf(
      '<p>\n      A single man of large fortune;\n      four or five thousand a year.\n    </p>',
    );
    const at = resolveIn(wrapper, 'A single man of large fortune; four or five thousand a year.');
    expect(at.chapter).toBe(0);
    expect(at.start.path).toEqual([0]);
  });

  test('overlay marks are transparent, so a second highlight still lands', () => {
    // salvage §1: the DOM has already been mutated by an earlier highlight.
    const plain = wrapperOf('<p>The path just admitted three.</p>');
    const marked = wrapperOf(
      '<p>The <mark class="hl" data-hl="x">path</mark> just admitted three.</p>',
    );
    expect(resolveIn(marked, 'just admitted three')).toEqual(
      resolveIn(plain, 'just admitted three'),
    );
  });

  test('an element with no text does not shift the paths after it', () => {
    const wrapper = wrapperOf('<p>First.</p><div></div><p>Second sentence here.</p>');
    const at = resolveIn(wrapper, 'Second sentence here.');
    expect(at.start.path).toEqual([2]);
  });
});

describe('the DocFragment hint, and what happens when it lies', () => {
  const chapters = [
    indexChapter(wrapperOf('<p>Chapter one has its own sentence.</p>')),
    indexChapter(wrapperOf('<p>Chapter two holds the quotation.</p>')),
    indexChapter(wrapperOf('<p>Chapter three is elsewhere.</p>')),
  ];

  test('a correct hint resolves in that chapter and is recorded as a hit', () => {
    const outcome = resolveAnnotation(annotation('holds the quotation', 1), chapters);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.at.chapter).toBe(1);
    expect(outcome.at.via).toBe('hint');
  });

  // crengine counts DocFragments over the spine IT rendered. When that drifts
  // from ours the highlight is still findable — the text is the real locator,
  // and the fallback is what makes the seam survive the disagreement.
  test('a wrong hint still resolves, and says it had to scan', () => {
    const outcome = resolveAnnotation(annotation('holds the quotation', 2), chapters);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.at.chapter).toBe(1);
    expect(outcome.at.via).toBe('scan');
  });

  test('an out-of-range hint is ignored rather than fatal', () => {
    const outcome = resolveAnnotation(annotation('holds the quotation', 99), chapters);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.at.chapter).toBe(1);
  });

  test('text that is nowhere in the book fails honestly', () => {
    const outcome = resolveAnnotation(annotation('this is not in any chapter', 0), chapters);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.why).toBe('not-found');
  });

  test('repeated text resolves but is flagged ambiguous', () => {
    const repeated = [indexChapter(wrapperOf('<p>Say it twice.</p><p>Say it twice.</p>'))];
    const outcome = resolveAnnotation(annotation('Say it twice.'), repeated);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.at.ambiguous).toBe(true);
    expect(outcome.at.start.path).toEqual([0]);
  });
});
