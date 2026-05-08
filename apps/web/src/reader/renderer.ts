// Chapter renderer.
//
// Takes a Book + chapter index, mounts the chapter HTML inside a shadow root,
// and rewrites in-archive resource URLs (img src, link href, source srcset, etc.)
// to blob URLs created from the EPUB's resource map.
//
// We sandbox via shadow DOM so the EPUB's CSS cannot leak to host styles.
// The host theme/font is forwarded into the shadow root via CSS custom
// properties on `:host`.

import type { Book, Chapter, Resource } from '../epub/index.ts';
import { resolveAgainst } from '../epub/path.ts';

export interface RenderOptions {
  fontScale: number;
  theme: 'light' | 'sepia' | 'dark';
}

export interface RenderedChapter {
  /** Element host for the shadow root. */
  host: HTMLElement;
  /** Tear down: revokes blob URLs and removes the host. */
  dispose(): void;
  /** Scroll to a fragment id within the chapter. */
  scrollToFragment(id: string): void;
  /** Get/set the chapter scroll offset. */
  getScroll(): number;
  setScroll(offset: number): void;
}

const SHADOW_HOST_TAG = 'div';

export function renderChapter(
  book: Book,
  chapter: Chapter,
  mount: HTMLElement,
  options: RenderOptions,
): RenderedChapter {
  // Clear existing content.
  mount.replaceChildren();

  const host = document.createElement(SHADOW_HOST_TAG);
  host.className = 'reader-chapter-host';
  mount.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const resource = book.resolveResource(chapter.path);
  if (!resource) {
    shadow.innerHTML = `<p style="color:#a33">Missing chapter content: ${escapeHtml(chapter.path)}</p>`;
    return makeStub(host);
  }

  const blobUrls: string[] = [];
  const html = decodeUtf8(resource.bytes);
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  // Some EPUBs are HTML-not-XHTML; fall back.
  const parsedDoc =
    doc.getElementsByTagName('parsererror').length === 0
      ? doc
      : new DOMParser().parseFromString(html, 'text/html');

  const body = findBody(parsedDoc);
  const headLinks = collectHeadStyles(parsedDoc, chapter.path, book, blobUrls);
  rewriteUrls(body, chapter.path, book, blobUrls);

  // Build the shadow content.
  const wrapper = document.createElement('div');
  wrapper.className = 'reader-chapter';

  const styleHost = document.createElement('style');
  styleHost.textContent = SHADOW_BASE_CSS;

  shadow.appendChild(styleHost);
  for (const link of headLinks) shadow.appendChild(link);

  // Move children of body into the wrapper.
  while (body.firstChild) {
    wrapper.appendChild(adoptNode(wrapper.ownerDocument, body.firstChild));
  }
  shadow.appendChild(wrapper);

  applyOptions(host, options);

  const dispose = (): void => {
    for (const url of blobUrls) URL.revokeObjectURL(url);
    host.remove();
  };

  const scrollToFragment = (id: string): void => {
    const target = shadow.getElementById(id);
    if (target) {
      target.scrollIntoView({ block: 'start' });
    }
  };

  const getScroll = (): number => mount.scrollTop;
  const setScroll = (offset: number): void => {
    mount.scrollTop = offset;
  };

  return { host, dispose, scrollToFragment, getScroll, setScroll };
}

export function applyOptions(host: HTMLElement, options: RenderOptions): void {
  host.style.setProperty('--reader-font-scale', String(options.fontScale));
  const theme = THEMES[options.theme];
  host.style.setProperty('--reader-bg', theme.bg);
  host.style.setProperty('--reader-fg', theme.fg);
  host.style.setProperty('--reader-link', theme.link);
  host.style.setProperty('--reader-muted', theme.muted);
}

function makeStub(host: HTMLElement): RenderedChapter {
  return {
    host,
    dispose: (): void => host.remove(),
    scrollToFragment: (): void => {},
    getScroll: (): number => 0,
    setScroll: (): void => {},
  };
}

function adoptNode(target: Document, node: Node): Node {
  if (node.ownerDocument === target) return node;
  return target.importNode(node, true);
}

const NS_XHTML = 'http://www.w3.org/1999/xhtml';

function findBody(doc: Document): Element {
  if (doc.body) return doc.body;
  const xhtmlBody = doc.getElementsByTagNameNS(NS_XHTML, 'body').item(0);
  if (xhtmlBody) return xhtmlBody;
  const anyBody = doc.getElementsByTagName('body').item(0);
  if (anyBody) return anyBody;
  return doc.documentElement;
}

function findHead(doc: Document): Element | null {
  if (doc.head) return doc.head;
  const xhtmlHead = doc.getElementsByTagNameNS(NS_XHTML, 'head').item(0);
  if (xhtmlHead) return xhtmlHead;
  return doc.getElementsByTagName('head').item(0);
}

/** Tag-name lookup that works for both HTML and XHTML namespaces. */
function allByTag(root: Element, name: string): Element[] {
  const xhtml = Array.from(root.getElementsByTagNameNS(NS_XHTML, name));
  if (xhtml.length > 0) return xhtml;
  return Array.from(root.getElementsByTagName(name));
}

function collectHeadStyles(
  doc: Document,
  chapterPath: string,
  book: Book,
  blobUrls: string[],
): HTMLStyleElement[] {
  // Inline external stylesheets and <style> blocks into the shadow so the
  // chapter looks correct without polluting the host.
  const out: HTMLStyleElement[] = [];
  const head = findHead(doc);
  if (!head) return out;

  for (const link of allByTag(head, 'link')) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase();
    if (rel !== 'stylesheet') continue;
    const href = link.getAttribute('href');
    if (!href || isExternal(href)) continue;
    const path = resolveAgainst(chapterPath, decodeURI(href));
    const resource = book.resolveResource(path);
    if (!resource) continue;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-source', path);
    styleEl.textContent = rewriteCssUrls(decodeUtf8(resource.bytes), path, book, blobUrls);
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
  for (const audio of Array.from(root.querySelectorAll('audio'))) rewriteAttr(audio, 'src');
  for (const video of Array.from(root.querySelectorAll('video'))) rewriteAttr(video, 'src');
  // Strip <script> entirely — EPUBs may carry them but the reader treats
  // chapter content as text + media only.
  for (const script of Array.from(root.querySelectorAll('script'))) script.remove();
  // Disarm anchors that point outside the EPUB; intra-EPUB links are
  // intercepted at the document level by the UI layer.
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (isExternal(href)) {
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
  const blob = new Blob([new Uint8Array(resource.bytes)], { type: resource.mediaType });
  return URL.createObjectURL(blob);
}

function isExternal(href: string): boolean {
  // True for absolute URLs (http, https, mailto, etc.) but NOT for blob:/data:.
  // Callers handle data:/# separately.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  if (href.startsWith('blob:') || href.startsWith('data:')) return false;
  return true;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

const THEMES: Record<
  RenderOptions['theme'],
  { bg: string; fg: string; link: string; muted: string }
> = {
  light: { bg: '#fafaf9', fg: '#1c1917', link: '#1d4ed8', muted: '#57534e' },
  sepia: { bg: '#f4ecd8', fg: '#3a2e1f', link: '#7a4a17', muted: '#6b5a3e' },
  dark: { bg: '#0f0f10', fg: '#e7e5e4', link: '#93c5fd', muted: '#a8a29e' },
};

const SHADOW_BASE_CSS = `
  :host {
    --reader-font-scale: 1;
    --reader-bg: #fafaf9;
    --reader-fg: #1c1917;
    --reader-link: #1d4ed8;
    --reader-muted: #57534e;
    display: block;
    color: var(--reader-fg);
    background: var(--reader-bg);
  }
  .reader-chapter {
    max-width: 38rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
    font-family: 'Iowan Old Style', 'Georgia', 'Cambria', serif;
    font-size: calc(1.05rem * var(--reader-font-scale));
    line-height: 1.65;
  }
  .reader-chapter p { margin: 0 0 1em; }
  .reader-chapter h1, .reader-chapter h2, .reader-chapter h3, .reader-chapter h4 {
    font-family: inherit;
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
  }
  .reader-chapter h1 { font-size: calc(1.7rem * var(--reader-font-scale)); }
  .reader-chapter h2 { font-size: calc(1.35rem * var(--reader-font-scale)); }
  .reader-chapter h3 { font-size: calc(1.15rem * var(--reader-font-scale)); }
  .reader-chapter a { color: var(--reader-link); }
  .reader-chapter blockquote {
    border-left: 3px solid var(--reader-muted);
    margin: 1em 0;
    padding: 0 0 0 1em;
    color: var(--reader-muted);
  }
  .reader-chapter img, .reader-chapter svg, .reader-chapter image {
    max-width: 100%;
    height: auto;
  }
  .reader-chapter pre, .reader-chapter code {
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 0.9em;
  }
`;
