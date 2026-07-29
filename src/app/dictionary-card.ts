// The dictionary card (parity E1): an inline popup over the page — headword,
// Webster 1913 definition, and a Wikipedia off-ramp link (the parity
// Wikipedia tab adapted to local-first; the Translation tab is refused as
// cloud-dependent). Chrome-independent; dismissed by outside tap (swallowed)
// or Escape via the shell's chain. The first lookup shows a loading line
// while the 5 MB artifact streams in — once only, ever.

import type { Dictionary } from '../reader/dictionary.ts';
import { normalizeTerm } from '../reader/dictionary.ts';
import { el } from './dom.ts';

export interface DictionaryCard {
  show(term: string): void;
  isOpen(): boolean;
  close(): void;
  dispose(): void;
}

export function createDictionaryCard(
  dictionary: Dictionary,
  opts: { passThrough?: () => Element[] } = {},
): DictionaryCard {
  const card = el<HTMLElement>('dict-card');
  const headwordEl = el<HTMLElement>('dict-headword');
  const bodyEl = el<HTMLElement>('dict-body');
  const wikiLink = el<HTMLAnchorElement>('dict-wiki');
  let showToken = 0;

  // Outside tap dismisses and is swallowed (never doubles as a page turn).
  // Elements in passThrough (the selection menu) keep their own clicks.
  const onDocClick = (event: MouseEvent): void => {
    const path = event.composedPath();
    if (path.includes(card)) return;
    if (opts.passThrough?.().some((elmt) => path.includes(elmt))) return;
    event.stopPropagation();
    event.preventDefault();
    close();
  };

  const close = (): void => {
    if (card.hidden) return;
    card.hidden = true;
    showToken += 1; // ignore any in-flight lookup
    document.removeEventListener('click', onDocClick, true);
  };

  const show = (term: string): void => {
    const query = normalizeTerm(term) || term.trim();
    const token = ++showToken;
    headwordEl.textContent = query;
    wikiLink.href = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`;
    if (dictionary.state() === 'ready') {
      card.dataset.state = 'busy';
      bodyEl.textContent = '';
    } else {
      card.dataset.state = 'loading';
      bodyEl.textContent = 'Loading dictionary…';
    }
    if (card.hidden) {
      card.hidden = false;
      document.addEventListener('click', onDocClick, true);
    }
    void dictionary.lookup(term).then((entry) => {
      if (token !== showToken || card.hidden) return; // superseded or closed
      if (!entry) {
        card.dataset.state = 'miss';
        bodyEl.textContent =
          dictionary.state() === 'failed'
            ? 'The dictionary could not be loaded.'
            : `No entry found for “${query}”.`;
        return;
      }
      card.dataset.state = 'hit';
      // Folded matches show their provenance: “travelling → travel”.
      headwordEl.textContent =
        entry.headword === query ? entry.headword : `${query} → ${entry.headword}`;
      bodyEl.textContent = entry.definition;
    });
  };

  return {
    show,
    isOpen: (): boolean => !card.hidden,
    close,
    dispose(): void {
      close();
    },
  };
}
