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

export interface ReaderView {
  /** Read at call time, never captured in a closure (salvage §2). */
  mode(): DisplayMode;
}

export interface RenderedChapter {
  host: HTMLElement;
  /** Tear down: revokes blob URLs and removes the host. */
  dispose(): void;
  scrollToFragment(id: string): void;
  getScroll(): number;
  setScroll(offset: number): void;
  /** Structural locator for the current viewport start (top or left edge). */
  getAnchor(): PositionAnchor | null;
  scrollToAnchor(anchor: PositionAnchor): void;
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

/** The comfortable text measure; also the paged column cap (salvage §2). */
const MEASURE_REM = 38;

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

  function remPx(): number {
    const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(size) && size > 0 ? size : 16;
  }

  function applyModeCss(): void {
    applied = view.mode();
    if (applied === 'paged') {
      const geom = columnGeometry(mount.clientWidth, MEASURE_REM * remPx());
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
    dispose(): void {
      observer?.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      for (const url of blobUrls) URL.revokeObjectURL(url);
      host.remove();
    },
    scrollToFragment(id: string): void {
      const target = shadow.getElementById(id);
      if (!target) return;
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
  .chapter {
    max-width: 38rem; /* keep in sync with MEASURE_REM */
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
    font-family: 'Charter', 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
    font-size: 1.05rem;
    line-height: 1.65;
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
  .chapter p { margin: 0 0 1em; }
  .chapter h1, .chapter h2, .chapter h3, .chapter h4 {
    font-family: inherit;
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    text-wrap: balance;
  }
  .chapter h1 { font-size: 1.7rem; }
  .chapter h2 { font-size: 1.35rem; }
  .chapter h3 { font-size: 1.15rem; }
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
  .chapter img, .chapter svg, .chapter image { max-width: 100%; height: auto; }
  /* Dark theme dims images (Kindle-style), never inverts; other themes set none. */
  .chapter img { filter: var(--img-dim, none); }
  .chapter pre, .chapter code { font-family: 'SF Mono', 'Menlo', monospace; font-size: 0.9em; }
`;
