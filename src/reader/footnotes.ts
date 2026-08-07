// Footnote detection (parity H2): deciding whether a link inside the book is
// a note reference that should pop up in place, or an ordinary jump.
//
// EPUB gives three signals, in descending order of confidence, and wild files
// carry any subset of them (salvage §3): the link's own `epub:type="noteref"`,
// the target's `epub:type` (footnote/endnote/rearnote), and the shape of the
// thing itself — a short `<aside>`, or a short block referenced by a marker
// that reads like a superscript. The pure predicate below is the whole rule;
// the DOM lookups belong to the caller, so this stays testable.

export const NS_EPUB_OPS = 'http://www.idpf.org/2007/ops';

/** epub:type however the file spells it: namespaced, or a literal prefix. */
export function epubType(el: Element): string {
  return el.getAttributeNS(NS_EPUB_OPS, 'type') ?? el.getAttribute('epub:type') ?? '';
}

function hasToken(type: string, tokens: Set<string>): boolean {
  return type.split(/\s+/).some((t) => tokens.has(t.toLowerCase().replace(/^.*:/, '')));
}

const NOTE_TYPES = new Set(['footnote', 'endnote', 'rearnote', 'note']);
const NOTEREF_TYPES = new Set(['noteref', 'note-ref']);

/** A note past this length is a section, not something to float over a page. */
export const FOOTNOTE_TEXT_CAP = 600;

/** Marker text that reads as a superscript: 1, [2], 17, *, †. */
export function isNoteMarkerText(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 6) return false;
  return /^[[(]?\d{1,4}[\])]?$/.test(t) || /^[*†‡§¶#]+$/.test(t);
}

export interface NoterefContext {
  /** epub:type of the link itself. */
  linkType: string;
  /** The link's visible text (usually the superscript marker). */
  linkText: string;
  /** Lowercased tag name of the fragment target. */
  targetTag: string;
  /** epub:type of the fragment target. */
  targetType: string;
  /** Length of the target's flattened text. */
  targetTextLength: number;
}

/**
 * Should this link pop its target up instead of navigating to it? Any one of
 * the three signals is enough; a target with no text at all never qualifies,
 * because an empty popover is worse than the jump it replaced.
 */
export function isFootnoteRef(ctx: NoterefContext): boolean {
  if (ctx.targetTextLength === 0) return false;
  if (hasToken(ctx.linkType, NOTEREF_TYPES)) return true;
  if (ctx.targetTextLength > FOOTNOTE_TEXT_CAP) return false;
  if (hasToken(ctx.targetType, NOTE_TYPES)) return true;
  if (ctx.targetTag === 'aside') return true;
  return isNoteMarkerText(ctx.linkText);
}
