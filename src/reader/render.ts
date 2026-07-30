// Chapter renderer: mounts one chapter's HTML inside a shadow root and
// rewrites in-archive resource URLs to blob URLs.
//
// Shadow DOM sandboxes the book: its CSS cannot leak into the app, and the
// app's theme flows in through custom properties on :host. Two display modes
// (paged CSS columns, continuous scroll); the locator functions speak both
// axes, so positions survive the switch.

import type { Book } from '../epub/book.ts';
import { resolveAgainst } from '../epub/path.ts';
import type { Chapter, Resource } from '../epub/types.ts';
import type { PositionAnchor } from '../library/types.ts';
import { absoluteStart, anchorFor, anchorTarget } from './locator.ts';
import type { DisplayMode } from './mode.ts';
import { columnGeometry, pageCount, pageIndexFor } from './paging.ts';

export type TextAlign = 'justify' | 'left';

/** Reader typography (parity C1–C6), applied through custom properties. */
export interface ReaderTypography {
  /** Resolved family stack, or null for the publisher default (no override). */
  fontStack: string | null;
  fontSizeRem: number;
  leading: number;
  weight: number;
  align: TextAlign;
}

/** The stock look; also what headless tests read. Matches the CSS fallbacks. */
export const DEFAULT_TYPOGRAPHY: ReaderTypography = {
  fontStack: null,
  fontSizeRem: 1.05,
  leading: 1.65,
  weight: 400,
  align: 'left',
};

export interface ReaderView {
  /** Read at call time, never captured in a closure (salvage §2). */
  mode(): DisplayMode;
  /** The comfortable text measure in CHARACTERS (C5), live: relayout() re-reads it. */
  measureCh(): number;
  /** Typography prefs, live: relayout() re-reads and re-applies them. */
  typography(): ReaderTypography;
}

export interface RenderedChapter {
  host: HTMLElement;
  /** Structural chapter root; the annotation layer serializes and marks against it. */
  wrapper: HTMLElement;
  /** The chapter's shadow root, for engine-specific selection lookup (salvage §1). */
  shadow: ShadowRoot;
  /** Tear down: revokes blob URLs and removes the host. */
  dispose(): void;
  scrollToFragment(id: string): void;
  /** Bring an element's page (paged) or offset (scroll) into view. */
  revealElement(el: Element): void;
  getScroll(): number;
  setScroll(offset: number): void;
  /** Structural locator for the current viewport start (top or left edge). */
  getAnchor(): PositionAnchor | null;
  scrollToAnchor(anchor: PositionAnchor): void;
  /** True when an anchor lands on the visible page (paged) / viewport (scroll). */
  anchorInView(anchor: PositionAnchor): boolean;
  /** Snap to a fraction of the chapter, through the same page-snap as anchors. */
  scrollToFraction(fraction: number): void;
  /** Re-apply mode CSS and restore the anchor; for mode switches and resize. */
  relayout(): void;
  /** One page forward/back (paged) or most of a screen (scroll). False at the chapter edge. */
  turnForward(): boolean;
  turnBack(): boolean;
  /** Position at the chapter's last page / bottom (entering a chapter backwards). */
  toEnd(): void;
  /** How far through this chapter the viewport is, 0..1. */
  chapterFraction(): number;
  /** True when the viewport sits at the chapter end. */
  atEnd(): boolean;
}

export function renderChapter(
  book: Book,
  chapter: Chapter,
  mount: HTMLElement,
  view: ReaderView,
): RenderedChapter {
  mount.replaceChildren();

  const host = document.createElement('div');
  host.className = 'chapter-host';
  mount.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const resource = book.resolveResource(chapter.path);
  const blobUrls: string[] = [];
  const wrapper = document.createElement('div');
  wrapper.className = 'chapter';
  // Hyphenation needs a language or `hyphens: auto` silently does nothing.
  wrapper.setAttribute('lang', book.metadata.language || 'en');

  if (resource) {
    const parsed = parseChapterDoc(new TextDecoder().decode(resource.bytes));
    const body = findBody(parsed);
    for (const styleEl of collectHeadStyles(parsed, chapter.path, book, blobUrls)) {
      shadow.appendChild(styleEl);
    }
    rewriteUrls(body, chapter.path, book, blobUrls);
    // adoptNode, not importNode: importing leaves the source's children in
    // place, so draining body.firstChild never terminates (a real bug once).
    while (body.firstChild) {
      wrapper.appendChild(document.adoptNode(body.firstChild));
    }
  } else {
    const missing = document.createElement('p');
    missing.textContent = `Missing chapter content: ${chapter.path}`;
    wrapper.appendChild(missing);
  }

  const style = document.createElement('style');
  style.textContent = SHADOW_BASE_CSS;
  shadow.prepend(style);
  shadow.appendChild(wrapper);

  // The measure probe: a `ch` is a property of the FACE at the CURRENT size, so
  // only the browser can say what the reader's character count is worth in
  // pixels — and the column geometry needs pixels. This element carries exactly
  // the chapter wrapper's type, is sized in ch, and is measured once per
  // applyModeCss. It is out of the flow and never renders anything.
  const probe = document.createElement('div');
  probe.className = 'measure-probe';
  shadow.appendChild(probe);

  // Guarantees the paged scroll range covers whole pages: column overflow
  // ends at the last column's right edge, without the trailing side pad, so
  // the last page's stride-aligned offset would otherwise be unreachable
  // (the browser clamps scrollLeft short and the page lands off-grid).
  const spacer = document.createElement('div');
  spacer.className = 'page-spacer';
  shadow.appendChild(spacer);

  // The mode the DOM is currently laid out in. view.mode() may change before
  // relayout() runs; capture must resolve against the layout on screen and
  // restore against the new one, so each side reads the applied state at call
  // time (salvage §2), never a value captured at closure creation.
  let applied: DisplayMode = view.mode();
  let gap = 0;

  const axis = (): 'h' | 'v' => (applied === 'paged' ? 'h' : 'v');
  const stride = (): number => mount.clientWidth; // stride === clientWidth exactly
  const pages = (): number => pageCount(mount.scrollWidth, mount.clientWidth, gap);
  const currentPage = (): number => pageIndexFor(mount.scrollLeft, stride());

  /**
   * The measure in pixels, read off the probe. Must be called AFTER
   * applyTypography, so the probe copies the face and size now on screen.
   */
  function measurePx(): number {
    const chapterStyle = getComputedStyle(wrapper);
    probe.style.fontFamily = chapterStyle.fontFamily;
    probe.style.fontSize = chapterStyle.fontSize;
    probe.style.fontWeight = chapterStyle.fontWeight;
    probe.style.fontStyle = chapterStyle.fontStyle;
    probe.style.width = `${view.measureCh()}ch`;
    const width = probe.getBoundingClientRect().width;
    if (width > 0) return width;
    // A headless DOM (and a detached mount) measures nothing; fall back to the
    // classic half-em per character rather than collapsing the column to zero.
    const fontSize = Number.parseFloat(chapterStyle.fontSize);
    return view.measureCh() * 0.5 * (Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16);
  }

  // Typography rides the same capture -> apply -> restore cycle as a mode
  // switch: the view accessors are read HERE, at apply time, so relayout()'s
  // anchor capture still sees the previous layout. Writing the properties
  // from outside the renderer would reflow before the capture and lose the
  // reading position.
  function applyTypography(): void {
    const typo = view.typography();
    host.style.setProperty('--reader-font-size', `${typo.fontSizeRem}rem`);
    host.style.setProperty('--reader-leading', String(typo.leading));
    host.style.setProperty('--reader-weight', String(typo.weight));
    host.style.setProperty('--reader-align', typo.align);
    host.style.setProperty('--reader-hyphens', typo.align === 'justify' ? 'auto' : 'manual');
    if (typo.fontStack) host.style.setProperty('--reader-font', typo.fontStack);
    else host.style.removeProperty('--reader-font');
    // Publisher default means NO override rule at all (gated by this class),
    // so the book's own font choices stay untouched.
    wrapper.classList.toggle('font-override', typo.fontStack !== null);
  }

  function applyModeCss(): void {
    applied = view.mode();
    applyTypography();
    // One measurement per layout, after the type is applied: both modes cap the
    // line at the same pixel width, so a mode switch never changes the measure.
    const measure = measurePx();
    host.style.setProperty('--reader-measure', `${measure}px`);
    if (applied === 'paged') {
      const geom = columnGeometry(mount.clientWidth, measure);
      gap = geom.gap;
      // The mount never scrolls vertically in paged mode; chrome bars overlay
      // the viewport, so showing them must not change this geometry.
      mount.style.overflow = 'hidden';
      host.style.height = `${mount.clientHeight}px`;
      wrapper.classList.add('paged');
      wrapper.style.setProperty('--column-width', `${geom.columnWidth}px`);
      wrapper.style.setProperty('--column-gap', `${geom.gap}px`);
      wrapper.style.setProperty('--side-pad', `${geom.sidePad}px`);
      // Columns must overflow the host horizontally or scrollWidth stays 0
      // and pagination dies silently (salvage §2); the demo scenes assert it.
      spacer.style.display = 'block';
      spacer.style.left = '0px';
      spacer.style.left = `${pages() * stride() - 1}px`;
    } else {
      gap = 0;
      mount.style.overflow = ''; // the app stylesheet restores overflow-y: auto
      host.style.height = '';
      wrapper.classList.remove('paged');
      spacer.style.display = 'none';
    }
  }

  /** Page whose span contains an h-axis offset, clamped into the chapter. */
  function pageStartFor(offset: number): number {
    if (stride() <= 0) return 0;
    const page = Math.min(Math.max(Math.floor(offset / stride()), 0), pages() - 1);
    return page * stride();
  }

  function restoreAnchor(anchor: PositionAnchor | null): void {
    if (applied === 'paged') {
      mount.scrollTop = 0;
      const target = anchor ? anchorTarget(wrapper, mount, anchor, 'h') : null;
      mount.scrollLeft = target === null ? 0 : pageStartFor(target);
    } else {
      mount.scrollLeft = 0;
      const target = anchor ? anchorTarget(wrapper, mount, anchor, 'v') : null;
      mount.scrollTop = target ?? 0;
    }
  }

  function turnFlash(): void {
    // Purely visual (opacity only): must never affect geometry reads.
    wrapper.animate?.([{ opacity: 0.55 }, { opacity: 1 }], { duration: 130, easing: 'ease-out' });
  }

  const rendered: RenderedChapter = {
    host,
    wrapper,
    shadow,
    dispose(): void {
      observer?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      for (const url of blobUrls) URL.revokeObjectURL(url);
      host.remove();
    },
    scrollToFragment(id: string): void {
      const target = shadow.getElementById(id);
      if (target) rendered.revealElement(target);
    },
    revealElement(target: Element): void {
      // Paged: snap to the page containing the element; scrollIntoView would
      // land between pages.
      if (applied === 'paged') mount.scrollLeft = pageStartFor(absoluteStart(target, mount, 'h'));
      else target.scrollIntoView({ block: 'start' });
    },
    getScroll: (): number => (applied === 'paged' ? mount.scrollLeft : mount.scrollTop),
    setScroll(offset: number): void {
      if (applied === 'paged') mount.scrollLeft = pageStartFor(offset);
      else mount.scrollTop = offset;
    },
    getAnchor: (): PositionAnchor | null => anchorFor(wrapper, mount, axis()),
    scrollToAnchor(anchor: PositionAnchor): void {
      restoreAnchor(anchor);
    },
    // "Is this bookmark on the page I am looking at?" — resolved through the
    // same axis-aware machinery as a restore, so the answer matches what the
    // reader sees in either display mode.
    anchorInView(anchor: PositionAnchor): boolean {
      if (applied === 'paged') {
        const target = anchorTarget(wrapper, mount, anchor, 'h') ?? 0;
        return pageStartFor(target) === pageStartFor(mount.scrollLeft);
      }
      const target = anchorTarget(wrapper, mount, anchor, 'v') ?? 0;
      return target >= mount.scrollTop && target < mount.scrollTop + mount.clientHeight;
    },
    scrollToFraction(fraction: number): void {
      const clamped = Math.min(Math.max(fraction, 0), 1);
      if (applied === 'paged') {
        mount.scrollTop = 0;
        mount.scrollLeft = pageStartFor(clamped * (mount.scrollWidth - mount.clientWidth));
      } else {
        mount.scrollLeft = 0;
        mount.scrollTop = clamped * Math.max(mount.scrollHeight - mount.clientHeight, 0);
      }
    },
    relayout(): void {
      // Never resolve geometry against a hidden viewport (salvage §2); the
      // resize observer re-runs this once the mount is visible again.
      if (mount.clientWidth <= 0 && mount.clientHeight <= 0) return;
      const anchor = anchorFor(wrapper, mount, axis()); // current layout's axis
      applyModeCss();
      restoreAnchor(anchor); // new layout's axis
    },
    turnForward(): boolean {
      if (applied === 'paged') {
        const next = currentPage() + 1;
        if (next > pages() - 1) return false;
        mount.scrollLeft = next * stride();
        turnFlash();
        return true;
      }
      const max = mount.scrollHeight - mount.clientHeight;
      if (mount.scrollTop >= max - 1) return false;
      mount.scrollTop = Math.min(mount.scrollTop + 0.88 * mount.clientHeight, max);
      return true;
    },
    turnBack(): boolean {
      if (applied === 'paged') {
        const current = currentPage();
        if (current <= 0) return false;
        mount.scrollLeft = (current - 1) * stride();
        turnFlash();
        return true;
      }
      if (mount.scrollTop <= 0) return false;
      mount.scrollTop = Math.max(mount.scrollTop - 0.88 * mount.clientHeight, 0);
      return true;
    },
    toEnd(): void {
      if (applied === 'paged') mount.scrollLeft = (pages() - 1) * stride();
      else mount.scrollTop = Math.max(mount.scrollHeight - mount.clientHeight, 0);
    },
    chapterFraction(): number {
      const paged = applied === 'paged';
      const max = paged
        ? mount.scrollWidth - mount.clientWidth
        : mount.scrollHeight - mount.clientHeight;
      const pos = paged ? mount.scrollLeft : mount.scrollTop;
      return max > 0 ? Math.min(Math.max(pos / max, 0), 1) : 0;
    },
    atEnd(): boolean {
      const paged = applied === 'paged';
      const max = paged
        ? mount.scrollWidth - mount.clientWidth
        : mount.scrollHeight - mount.clientHeight;
      return (paged ? mount.scrollLeft : mount.scrollTop) >= max - 1;
    },
  };

  applyModeCss();

  // Resize re-derives column geometry and re-anchors; debounced because
  // interactive resizes stream events. Guarded: jsdom has no ResizeObserver.
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    let initial = true;
    observer = new ResizeObserver(() => {
      if (initial) {
        initial = false; // the observe() call itself fires once; layout is fresh
        return;
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => rendered.relayout(), 150);
    });
    observer.observe(mount);
  }

  return rendered;
}

// --- document parsing ---

const NS_XHTML = 'http://www.w3.org/1999/xhtml';

/** Shared with metrics.ts: character counts must see the same DOM the renderer shows. */
export function parseChapterDoc(html: string): Document {
  // XHTML first per spec; wild EPUBs ship plain HTML, so fall back on error.
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length === 0) return doc;
  return new DOMParser().parseFromString(html, 'text/html');
}

export function findBody(doc: Document): Element {
  // XHTML documents may not populate doc.body; fall through the namespaces.
  return (
    doc.body ??
    doc.getElementsByTagNameNS(NS_XHTML, 'body').item(0) ??
    doc.getElementsByTagName('body').item(0) ??
    doc.documentElement
  );
}

function findHead(doc: Document): Element | null {
  return (
    doc.head ??
    doc.getElementsByTagNameNS(NS_XHTML, 'head').item(0) ??
    doc.getElementsByTagName('head').item(0)
  );
}

function allByTag(root: Element, name: string): Element[] {
  const xhtml = Array.from(root.getElementsByTagNameNS(NS_XHTML, name));
  return xhtml.length > 0 ? xhtml : Array.from(root.getElementsByTagName(name));
}

// --- resource rewriting ---

function collectHeadStyles(
  doc: Document,
  chapterPath: string,
  book: Book,
  blobUrls: string[],
): HTMLStyleElement[] {
  // Inline the book's stylesheets into the shadow so the chapter looks right
  // without polluting the host document.
  const out: HTMLStyleElement[] = [];
  const head = findHead(doc);
  if (!head) return out;

  for (const link of allByTag(head, 'link')) {
    if ((link.getAttribute('rel') ?? '').toLowerCase() !== 'stylesheet') continue;
    const href = link.getAttribute('href');
    if (!href || isExternal(href)) continue;
    const path = resolveAgainst(chapterPath, decodeURI(href));
    const resource = book.resolveResource(path);
    if (!resource) continue;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-source', path);
    styleEl.textContent = rewriteCssUrls(
      new TextDecoder().decode(resource.bytes),
      path,
      book,
      blobUrls,
    );
    out.push(styleEl);
  }

  for (const styleNode of allByTag(head, 'style')) {
    const styleEl = document.createElement('style');
    styleEl.textContent = rewriteCssUrls(styleNode.textContent ?? '', chapterPath, book, blobUrls);
    out.push(styleEl);
  }

  return out;
}

function rewriteUrls(root: Element, chapterPath: string, book: Book, blobUrls: string[]): void {
  const rewriteAttr = (el: Element, attr: string): void => {
    const value = el.getAttribute(attr);
    if (!value || isExternal(value) || value.startsWith('#') || value.startsWith('data:')) return;
    const path = resolveAgainst(chapterPath, decodeURI(value.split('#')[0] ?? value));
    const url = blobUrlFor(path, book, blobUrls);
    if (url) el.setAttribute(attr, url);
  };

  for (const img of Array.from(root.querySelectorAll('img'))) rewriteAttr(img, 'src');
  for (const image of Array.from(root.querySelectorAll('image'))) {
    const xlink = image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (xlink && !isExternal(xlink)) {
      const path = resolveAgainst(chapterPath, decodeURI(xlink));
      const url = blobUrlFor(path, book, blobUrls);
      if (url) image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    }
    rewriteAttr(image, 'href');
  }
  for (const source of Array.from(root.querySelectorAll('source'))) rewriteAttr(source, 'src');
  for (const media of Array.from(root.querySelectorAll('audio, video'))) rewriteAttr(media, 'src');
  sanitizeContent(root);
  markNoteBlocks(root);
  // External links leave the app in a new tab; a dangerous scheme is stripped
  // outright. Internal links are intercepted by the shell at the document level.
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    const scheme = urlScheme(href);
    if (scheme && !SAFE_LINK_SCHEMES.has(scheme)) {
      a.removeAttribute('href'); // javascript:, data:, vbscript:, ...
    } else if (isExternal(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
}

// Book HTML is untrusted (it can originate from arbitrary web pages via the
// conversion pipeline). Shadow DOM sandboxes the book's CSS and DOM, but NOT
// script execution: an inline `onerror`/`onload` handler or a framed document
// would run in the app's own realm, with access to the library and its
// credentials. So the reader renders text + media only, never active content.
const ACTIVE_TAGS = new Set(['script', 'iframe', 'frame', 'object', 'embed']);
const SAFE_LINK_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Tag note blocks (H2) so the shadow CSS can set them like real footnotes:
 * present at the foot of the chapter, quiet enough to skip. A class, never a
 * move or a removal — the structure locators address must stay exactly as it
 * was, and "Go to note" needs somewhere to land.
 */
function markNoteBlocks(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('aside, div, section, p'))) {
    const type = el.getAttributeNS(NS_EPUB_OPS, 'type') ?? el.getAttribute('epub:type') ?? '';
    if (type.split(/\s+/).some((t) => NOTE_TYPES.has(t.toLowerCase()))) {
      el.classList.add('note-block');
    }
  }
}

const NS_EPUB_OPS = 'http://www.idpf.org/2007/ops';
const NOTE_TYPES = new Set(['footnote', 'endnote', 'rearnote', 'note']);

export function sanitizeContent(root: Element): void {
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (ACTIVE_TAGS.has(child.localName.toLowerCase())) child.remove();
      else walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      // on* event handlers (onerror, onload, onclick, SVG onbegin, ...).
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  };
  walk(root);
}

/** The URL scheme, lowercased, after removing the whitespace browsers ignore. */
export function urlScheme(href: string): string | null {
  const cleaned = href
    .replace(/[\t\n\r]/g, '')
    .trimStart()
    .toLowerCase();
  const match = cleaned.match(/^([a-z][a-z0-9+.-]*):/);
  return match?.[1] ?? null;
}

function rewriteCssUrls(css: string, ownerPath: string, book: Book, blobUrls: string[]): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote, raw) => {
    const url = String(raw).trim();
    if (isExternal(url) || url.startsWith('data:') || url.startsWith('#')) return match;
    const path = resolveAgainst(ownerPath, decodeURI(url));
    const blob = blobUrlFor(path, book, blobUrls);
    return blob ? `url("${blob}")` : match;
  });
}

function blobUrlFor(path: string, book: Book, blobUrls: string[]): string | null {
  const resource = book.resolveResource(path);
  if (!resource) return null;
  const url = makeBlobUrl(resource);
  blobUrls.push(url);
  return url;
}

function makeBlobUrl(resource: Resource): string {
  const blob = new Blob([resource.bytes.slice()], { type: resource.mediaType });
  return URL.createObjectURL(blob);
}

function isExternal(href: string): boolean {
  // Absolute URLs (http, mailto, ...) but not blob:/data:, handled separately.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return !href.startsWith('blob:') && !href.startsWith('data:');
}

// --- base typography inside the shadow ---

// Colors come exclusively from the app stylesheet's theme tokens (parity D1):
// custom properties inherit through the shadow boundary, so the [data-theme]
// blocks in web/styles.css are the single source of truth. The var() fallbacks
// mirror the paper theme purely for headless rendering (tests without the app
// stylesheet); no color may be defined here outside a fallback (salvage §7).
const SHADOW_BASE_CSS = `
  :host {
    display: block;
    position: relative;
    color: var(--fg, #24211b);
    background: var(--bg, #f5f4ef);
  }
  /* Typography flows in as --reader-* custom properties on the chapter host,
     written by applyTypography() from the ReaderView at relayout time; the
     fallbacks are the stock look. Weight sets the wrapper only and inherits:
     strong/b/headings keep their own (relatively bolder) weights. */
  .chapter {
    max-width: var(--reader-measure, 38rem);
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
    font-family: 'Charter', 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
    font-size: var(--reader-font-size, 1.05rem);
    line-height: var(--reader-leading, 1.65);
    font-weight: var(--reader-weight, 400);
    text-align: var(--reader-align, left);
    -webkit-hyphens: var(--reader-hyphens, manual);
    hyphens: var(--reader-hyphens, manual);
  }
  /* Curated-face override (C1): everything except code, which stays mono.
     The later :is() block wins on specificity and order. */
  .chapter.font-override, .chapter.font-override * {
    font-family: var(--reader-font, inherit) !important;
  }
  .chapter.font-override :is(pre, code, kbd, samp),
  .chapter.font-override :is(pre, code, kbd, samp) * {
    font-family: 'SF Mono', 'Menlo', monospace !important;
  }
  /* Paged: one column per page, geometry injected as custom properties by
     applyModeCss. column-fill: auto is load-bearing: without it columns
     balance instead of filling the viewport height. */
  .chapter.paged {
    height: 100%;
    box-sizing: border-box;
    max-width: none;
    margin: 0;
    padding: 2rem var(--side-pad, 1.5rem);
    column-width: var(--column-width, 38rem);
    column-gap: var(--column-gap, 3rem);
    column-fill: auto;
  }
  .chapter.paged img, .chapter.paged figure, .chapter.paged svg {
    max-height: 85vh;
    break-inside: avoid;
  }
  .page-spacer {
    display: none;
    position: absolute;
    top: 0;
    width: 1px;
    height: 1px;
  }
  /* The measure probe (see measurePx): sized in ch, wearing the chapter's own
     type, out of the flow, painting nothing. */
  .measure-probe {
    position: absolute;
    top: 0;
    left: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }
  .chapter p { margin: 0 0 1em; }
  .chapter h1, .chapter h2, .chapter h3, .chapter h4 {
    font-family: inherit;
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    text-wrap: balance;
  }
  /* Chapter openings: real air above the heading, and small caps on the FIRST
     LINE of the paragraph that follows it — the bundled faces carry true small
     caps, so the strongest "this is a book" cue costs one rule. Scoped to the
     immediately-following paragraph, so it can only ever hit an opening. No
     drop caps: they fight too many books and read wrong outside fiction. */
  .chapter :is(h1, h2, h3) { margin-top: 2.6em; }
  .chapter :is(h1, h2, h3) + p::first-line {
    font-variant-caps: small-caps;
    font-feature-settings: "smcp" 1;
  }
  /* em, not rem: headings scale with the reader's font-size steps. */
  .chapter h1 { font-size: 1.6em; }
  .chapter h2 { font-size: 1.3em; }
  .chapter h3 { font-size: 1.1em; }
  .chapter a {
    color: var(--link, #33518a);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.15em;
  }
  .chapter blockquote {
    border-left: 2px solid var(--link, #33518a);
    margin: 1em 0;
    padding: 0 0 0 1em;
    color: var(--muted, #6e6759);
  }
  /* Highlights (F1–F3): overlay marks, invisible to locators (mark.hl in
     locator.ts). Tints come from the theme token blocks in web/styles.css;
     the fallbacks mirror the paper theme for headless rendering. Marks wrap
     only text; the note marker is a pseudo-element so that stays true. */
  mark.hl {
    color: inherit;
    background: var(--hl-yellow, #f2dd80);
    border-radius: 2px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  mark.hl.hl-pink { background: var(--hl-pink, #f4bccb); }
  mark.hl.hl-blue { background: var(--hl-blue, #b1d4f2); }
  mark.hl.hl-orange { background: var(--hl-orange, #f5c491); }
  mark.hl.has-note::after {
    content: '\\270E';
    font-size: 0.72em;
    vertical-align: super;
    margin-left: 0.12em;
    color: var(--muted, #6e6759);
  }
  /* Find hits (H5): a temporary overlay, cleared when search closes. Also
     locator-invisible (mark.find-hit in locator.ts), so a position saved
     while hits are marked restores identically once they are gone. */
  mark.find-hit {
    color: inherit;
    background: var(--find-hit, #cfe3b0);
    border-radius: 2px;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }
  mark.hl.hl-flash, mark.find-hit.hl-flash { animation: hl-flash 0.9s ease-out; }
  @keyframes hl-flash {
    0% { outline: 3px solid var(--link, #33518a); outline-offset: 1px; }
    100% { outline: 3px solid transparent; outline-offset: 1px; }
  }
  /* Note blocks (H2): kept in the flow where the publisher put them — the
     popover is the shortcut, not a replacement — but set like footnotes so
     they read as apparatus rather than as text. */
  .chapter .note-block {
    font-size: 0.85em;
    color: var(--muted, #6e6759);
    border-top: 1px solid var(--line, #ddd8cc);
    margin-top: 1.6em;
    padding-top: 0.6em;
  }
  .chapter img, .chapter svg, .chapter image { max-width: 100%; height: auto; }
  /* Dark theme dims images (Kindle-style), never inverts; other themes set none. */
  .chapter img { filter: var(--img-dim, none); }
  .chapter pre, .chapter code { font-family: 'SF Mono', 'Menlo', monospace; font-size: 0.9em; }
`;
