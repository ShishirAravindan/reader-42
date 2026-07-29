// Reading a text selection out of the chapter's shadow root. Engine-specific
// (salvage §1): Chromium exposes shadow selections via shadowRoot
// .getSelection(); elsewhere the document selection is consulted and checked
// for containment, so a selection in the app chrome never reads as book text.

export const WORD_MAX_CHARS = 48;

interface SelectionSource {
  getSelection?(): Selection | null;
}

/** The current non-collapsed selection inside the shadow root, or null. */
export function readerSelection(shadowRoot: ShadowRoot): Range | null {
  const selection =
    (shadowRoot as ShadowRoot & SelectionSource).getSelection?.() ??
    shadowRoot.ownerDocument.defaultView?.getSelection() ??
    null;
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  // Containment: the range must live in THIS shadow tree.
  if (range.commonAncestorContainer.getRootNode() !== shadowRoot) return null;
  return range;
}

/** A single dictionary-ready word from a range: trimmed of surrounding
 * punctuation and whitespace, no internal spaces, bounded length. */
export function wordFromSelection(range: Range): string | null {
  return singleWord(range.toString());
}

/** The same trimming for arbitrary text (e.g. a phrase's first word). */
export function singleWord(text: string): string | null {
  const word = trimPunctuation(text.trim());
  if (!word || word.length > WORD_MAX_CHARS || /\s/.test(word)) return null;
  return word;
}

function trimPunctuation(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}
