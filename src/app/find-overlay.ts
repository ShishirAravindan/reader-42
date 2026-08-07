// Find marks (H5) live on whichever chapter is rendered, addressed by their
// index in the active result list. They are overlay marks, so locators are
// blind to them: a position saved while the page is lit restores identically
// once they are gone (salvage §1).
//
// Which chapter carries marks and when they clear is one rule, so it lives in
// one place rather than spread across the search panel and the shell.

import type { RenderedChapter } from '../reader/render.ts';
import {
  type SearchHit,
  applyFindMarks,
  clearFindMarks,
  findMarks,
  flashFindMark,
} from '../reader/search.ts';

export interface FindOverlayDeps {
  /** The live rendered chapter, or null before the first render. */
  view(): RenderedChapter | null;
  chapter(): number;
  /** The active result list; marks address hits by their index in it. */
  hits(): SearchHit[];
}

export interface FindOverlay {
  /** Re-mark the rendered chapter: every render starts mark-free. */
  applyChapter(): void;
  clear(): void;
  /** Bring hit `index` into view and pulse it. */
  reveal(index: number): void;
}

export function createFindOverlay(deps: FindOverlayDeps): FindOverlay {
  return {
    applyChapter(): void {
      const view = deps.view();
      if (!view) return;
      clearFindMarks(view.wrapper);
      const hits = deps.hits();
      if (hits.length > 0) applyFindMarks(view.wrapper, hits, deps.chapter());
    },
    clear(): void {
      const view = deps.view();
      if (view) clearFindMarks(view.wrapper);
    },
    reveal(index: number): void {
      const view = deps.view();
      const mark = view ? findMarks(view.wrapper, index)[0] : undefined;
      if (!view || !mark) return;
      view.revealElement(mark);
      flashFindMark(view.wrapper, index);
    },
  };
}
