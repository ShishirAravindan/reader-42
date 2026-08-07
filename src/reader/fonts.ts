// Waiting for a reading face to actually arrive.
//
// Every bundled face is declared `font-display: swap`, which is the right
// choice for reading — text appears immediately in a fallback and re-renders
// when the real face lands, rather than making the reader stare at nothing.
// But it means the face on screen at first paint is NOT the face the reader
// chose, and the renderer's measure probe is a geometry read: it asks the
// browser what a character of THIS face at THIS size is worth in pixels, and
// gets the fallback's answer.
//
// A wrong answer there is not cosmetic. The column is sized in characters, so
// a measure taken against the fallback serif sizes the page for a book set in
// something the reader is not reading; in paged mode that changes the page
// stride, so a restored position lands a page or two off. The fix is one extra
// layout pass once the face is resident, and this module is where "once the
// face is resident" is defined, for every caller that needs it.

/** The CSS font shorthand a FontFaceSet lookup wants, from a resolved style. */
export function fontSpec(style: {
  fontStyle: string;
  fontWeight: string;
  fontSize: string;
  fontFamily: string;
}): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

/**
 * Call `then` once the face described by `spec` is loaded AND the layout it
 * triggers has settled — but ONLY if it was not already resident.
 *
 * Skipping the callback in the already-resident case is the whole contract:
 * it is what lets a caller re-enter this on every layout without looping, and
 * it means the common path (a face the reader has been reading for an hour)
 * costs one synchronous `check` and nothing else.
 *
 * Everything here is defensive because the callers include a jsdom test suite
 * with no font machinery at all, and because a face that 404s must degrade to
 * "keep the fallback", never to a thrown error inside a layout.
 */
export function afterFaceLoads(spec: string, then: () => void): void {
  const fonts: FontFaceSet | undefined = document.fonts;
  if (typeof fonts?.load !== 'function' || typeof fonts.check !== 'function') return;
  try {
    if (fonts.check(spec)) return; // already there: the measure just taken was true
  } catch {
    return; // no FontFaceSet worth the name (jsdom), or a spec it cannot parse
  }
  void fonts
    .load(spec)
    // `ready` and not just `load`: the face being downloaded is not the same
    // as the layout that uses it having happened.
    .then(() => fonts.ready)
    .then(() => then())
    .catch(() => {
      // A face that never arrives is a face the reader reads in the fallback,
      // which is exactly what the fallback is for. No second pass, no error.
    });
}
