// In-book links: where a tap on a link inside the chapter goes.
//
// Three outcomes, and the order matters. An absolute URL (any scheme) is left
// entirely to the browser — external links open in a new tab. A bare fragment
// that points at something note-shaped pops the note over the page (parity H2),
// so the reading position never moves and there is nothing to come back from.
// Everything else is a real jump, routed through the shell's jump-back wrapper.
//
// The note-vs-navigation decision is the pure predicate in reader/footnotes.ts;
// this module only performs the DOM lookups it needs.

import { epubType, isFootnoteRef } from '../reader/footnotes.ts';
import { flattenText } from '../reader/metrics.ts';
import type { RenderedChapter } from '../reader/render.ts';
import type { FootnotePopover } from './footnote-popover.ts';

export interface InBookLinkDeps {
  /** The live rendered chapter; its shadow root resolves fragments. */
  currentView(): RenderedChapter | null;
  currentChapter(): number;
  /** Archive path of a chapter, or null when there is no such chapter. */
  chapterPath(chapter: number): string | null;
  footnotes: FootnotePopover;
  /** Records the way back, then runs the jump (the shell's wrapper). */
  jumpFrom(run: () => void): void;
  goToChapter(chapter: number, fragment?: string): void;
  goToPath(path: string, fragment: string | null): void;
}

/** Wire the viewport's link handling; the returned function detaches it. */
export function attachInBookLinks(viewport: HTMLElement, deps: InBookLinkDeps): () => void {
  viewport.onclick = (event): void => {
    const target = event.composedPath().find((n): n is HTMLAnchorElement => {
      return n instanceof HTMLAnchorElement && n.hasAttribute('href');
    });
    if (!target) return;
    const href = target.getAttribute('href') ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return; // external, opens in new tab
    event.preventDefault();
    const [path, fragment] = href.split('#');
    const basePath = deps.chapterPath(deps.currentChapter());
    if (basePath === null) return;
    if (!path && fragment) {
      // A same-chapter note shows in place (H2) rather than navigating: the
      // reading position never moves, so there is nothing to come back from.
      const view = deps.currentView();
      const note = view?.shadow.getElementById(fragment) ?? null;
      if (
        view &&
        note &&
        isFootnoteRef({
          linkType: epubType(target),
          linkText: target.textContent ?? '',
          targetTag: note.localName.toLowerCase(),
          targetType: epubType(note),
          targetTextLength: flattenText(note.textContent ?? '').length,
        })
      ) {
        const here = deps.currentChapter();
        deps.footnotes.show(target.getBoundingClientRect(), note, () => {
          deps.jumpFrom(() => deps.goToChapter(here, fragment));
        });
        return;
      }
      deps.jumpFrom(() => deps.goToChapter(deps.currentChapter(), fragment));
      return;
    }
    const resolved = resolveHref(basePath, path ?? '');
    deps.jumpFrom(() => deps.goToPath(resolved, fragment ?? null));
  };
  return (): void => {
    viewport.onclick = null;
  };
}

/**
 * An href relative to the chapter it was written in, as an archive path.
 * Pure string work: the EPUB's own paths are the only truth here.
 */
export function resolveHref(basePath: string, href: string): string {
  const base = basePath.split('/').slice(0, -1);
  const out = [...base];
  for (const part of href.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
