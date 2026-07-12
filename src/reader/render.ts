// Chapter renderer: mounts one chapter's HTML inside a shadow root and
// rewrites in-archive resource URLs to blob URLs.
//
// Shadow DOM sandboxes the book: its CSS cannot leak into the app, and the
// app's theme flows in through custom properties on :host. Scroll mode only
// for now; the locator functions already speak both axes for paged mode later.

import type { Book } from '../epub/book.ts';
import { resolveAgainst } from '../epub/path.ts';
import type { Chapter, Resource } from '../epub/types.ts';
import type { PositionAnchor } from '../library/types.ts';
import { absoluteStart, anchorFor, anchorTarget } from './locator.ts';

export interface RenderedChapter {
  host: HTMLElement;
  /** Tear down: revokes blob URLs and removes the host. */
  dispose(): void;
  scrollToFragment(id: string): void;
  getScroll(): number;
  setScroll(offset: number): void;
  /** Structural locator for the current viewport top. */
  getAnchor(): PositionAnchor | null;
  scrollToAnchor(anchor: PositionAnchor): void;
  /** How far through this chapter the viewport is, 0..1. */
  chapterFraction(): number;
  /** True when the viewport sits at the chapter bottom. */
  atEnd(): boolean;
}

export function renderChapter(book: Book, chapter: Chapter, mount: HTMLElement): RenderedChapter {
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

  return {
    host,
    dispose(): void {
      for (const url of blobUrls) URL.revokeObjectURL(url);
      host.remove();
    },
    scrollToFragment(id: string): void {
      shadow.getElementById(id)?.scrollIntoView({ block: 'start' });
    },
    getScroll: (): number => mount.scrollTop,
    setScroll(offset: number): void {
      mount.scrollTop = offset;
    },
    getAnchor: (): PositionAnchor | null => anchorFor(wrapper, mount, 'v'),
    scrollToAnchor(anchor: PositionAnchor): void {
      const target = anchorTarget(wrapper, mount, anchor, 'v');
      mount.scrollTop = target ?? 0;
    },
    chapterFraction(): number {
      const max = mount.scrollHeight - mount.clientHeight;
      return max > 0 ? Math.min(mount.scrollTop / max, 1) : 0;
    },
    atEnd(): boolean {
      return mount.scrollTop >= mount.scrollHeight - mount.clientHeight - 1;
    },
  };
}

// --- document parsing ---

const NS_XHTML = 'http://www.w3.org/1999/xhtml';

function parseChapterDoc(html: string): Document {
  // XHTML first per spec; wild EPUBs ship plain HTML, so fall back on error.
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length === 0) return doc;
  return new DOMParser().parseFromString(html, 'text/html');
}

function findBody(doc: Document): Element {
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
  // The reader treats chapter content as text + media only.
  for (const script of Array.from(root.querySelectorAll('script'))) script.remove();
  // External links leave the app in a new tab; internal links are intercepted
  // by the shell at the document level.
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    if (isExternal(a.getAttribute('href') ?? '')) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }
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

const SHADOW_BASE_CSS = `
  :host {
    --reader-fg: #24211b;
    --reader-bg: #f5f4ef;
    --reader-link: #33518a;
    --reader-muted: #6e6759;
    display: block;
    color: var(--reader-fg);
    background: var(--reader-bg);
  }
  .chapter {
    max-width: 38rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
    font-family: 'Charter', 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
    font-size: 1.05rem;
    line-height: 1.65;
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
    color: var(--reader-link);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.15em;
  }
  .chapter blockquote {
    border-left: 2px solid var(--reader-link);
    margin: 1em 0;
    padding: 0 0 0 1em;
    color: var(--reader-muted);
  }
  .chapter img, .chapter svg, .chapter image { max-width: 100%; height: auto; }
  .chapter pre, .chapter code { font-family: 'SF Mono', 'Menlo', monospace; font-size: 0.9em; }
`;
