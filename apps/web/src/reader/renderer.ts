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

export type DisplayMode = 'scroll' | 'paged';
export type TypoStep = 's' | 'm' | 'l';

export interface RenderOptions {
  fontScale: number;
  theme: 'light' | 'sepia' | 'dark';
  mode: DisplayMode;
  measure: TypoStep;
  leading: TypoStep;
}

/**
 * Structural position inside a chapter: child-index path from the chapter
 * wrapper to the topmost visible element, plus how far into that element the
 * viewport top sits (0..1). Survives font-scale changes and, later, display-
 * mode switches — unlike a raw pixel offset (ADR 0005).
 */
export interface PositionAnchor {
  path: number[];
  ratio: number;
}

/**
 * A highlighted span: element-index paths from the chapter wrapper to the
 * elements containing each boundary, plus character offsets within those
 * elements' flattened text. Same locator family as PositionAnchor — stable
 * across display modes and typography changes.
 */
export interface HighlightRange {
  startPath: number[];
  startOffset: number;
  endPath: number[];
  endOffset: number;
  text: string;
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
  /** Structural locator for the current viewport top. */
  getAnchor(): PositionAnchor | null;
  scrollToAnchor(anchor: PositionAnchor): void;
  /** Text content of the element an anchor points at (for bookmark labels). */
  textAt(anchor: PositionAnchor): string | null;
  /** How far through this chapter the viewport is, 0..1. */
  chapterFraction(): number;
  /** Find the first occurrence of term, mark it, scroll to it. */
  findAndMark(term: string): boolean;
  /** Serialize the current text selection (if inside this chapter). */
  serializeSelection(): HighlightRange | null;
  /** Paint a stored highlight; false if its locator no longer resolves. */
  applyHighlight(id: string, range: HighlightRange, hasNote: boolean): boolean;
  removeHighlight(id: string): void;
  setNoteFlag(id: string, hasNote: boolean): void;
  scrollToHighlight(id: string): boolean;
  /** Paged mode: 1-based current page and page count (1/1 in scroll mode). */
  pageInfo(): { page: number; pages: number };
  /** Paged mode: step one page; returns false at the chapter edge. */
  pageBy(direction: 1 | -1): boolean;
  /** Jump to the end of the chapter (last page / bottom). */
  scrollToEnd(): void;
  /** True when the viewport sits at the chapter's last page / bottom. */
  atEnd(): boolean;
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

  // Mode is read from the host attribute at call time, so a mode switch
  // between getAnchor (old layout) and scrollToAnchor (new layout) does the
  // right thing on each side.
  const isPaged = (): boolean => host.dataset.mode === 'paged';
  const pageWidth = (): number => Math.max(mount.clientWidth, 1);

  const snapToPage = (target: number): void => {
    const width = pageWidth();
    const maxLeft = Math.max(mount.scrollWidth - width, 0);
    mount.scrollLeft = Math.min(Math.max(Math.round(target / width) * width, 0), maxLeft);
  };

  const scrollToFragment = (id: string): void => {
    const target = shadow.getElementById(id);
    if (!target) return;
    if (isPaged()) {
      snapToPage(absoluteStart(target, mount, 'h'));
    } else {
      target.scrollIntoView({ block: 'start' });
    }
  };

  const getScroll = (): number => (isPaged() ? mount.scrollLeft : mount.scrollTop);
  const setScroll = (offset: number): void => {
    if (isPaged()) snapToPage(offset);
    else mount.scrollTop = offset;
  };
  const getAnchor = (): PositionAnchor | null => anchorFor(wrapper, mount, isPaged() ? 'h' : 'v');
  const scrollToAnchor = (anchor: PositionAnchor): void => {
    if (isPaged()) {
      const target = anchorTarget(wrapper, mount, anchor, 'h');
      if (target === null) mount.scrollLeft = 0;
      else snapToPage(target);
    } else {
      const target = anchorTarget(wrapper, mount, anchor, 'v');
      mount.scrollTop = target ?? 0;
    }
  };

  const textAt = (anchor: PositionAnchor): string | null => {
    const el = elementAtPath(anchor.path);
    if (!el || el === wrapper) return null;
    const text = (el.textContent ?? '').trim();
    return text.length > 0 ? text : null;
  };

  const pageInfo = (): { page: number; pages: number } => {
    if (!isPaged()) return { page: 1, pages: 1 };
    const width = pageWidth();
    const pages = Math.max(Math.round(mount.scrollWidth / width), 1);
    const page = Math.min(Math.round(mount.scrollLeft / width) + 1, pages);
    return { page, pages };
  };

  const pageBy = (direction: 1 | -1): boolean => {
    if (!isPaged()) return false;
    const width = pageWidth();
    const maxLeft = Math.max(mount.scrollWidth - width, 0);
    const current = Math.round(mount.scrollLeft / width) * width;
    const target = current + direction * width;
    if (target < 0 || target > maxLeft + width / 2) return false;
    mount.scrollLeft = Math.min(target, maxLeft);
    return true;
  };

  const scrollToEnd = (): void => {
    if (isPaged()) {
      const width = pageWidth();
      const maxLeft = Math.max(mount.scrollWidth - width, 0);
      mount.scrollLeft = maxLeft;
    } else {
      mount.scrollTop = mount.scrollHeight;
    }
  };

  const atEnd = (): boolean => {
    if (isPaged()) {
      const { page, pages } = pageInfo();
      return page >= pages;
    }
    return mount.scrollTop >= mount.scrollHeight - mount.clientHeight - 1;
  };

  const chapterFraction = (): number => {
    if (isPaged()) {
      const { page, pages } = pageInfo();
      return pages > 1 ? (page - 1) / pages : 0;
    }
    const max = mount.scrollHeight - mount.clientHeight;
    return max > 0 ? Math.min(mount.scrollTop / max, 1) : 0;
  };

  // --- highlights ---

  const elementPathOf = (el: Element): number[] | null => {
    const path: number[] = [];
    let current: Element | null = el;
    while (current && current !== wrapper) {
      const parent: Element | null = current.parentElement;
      if (!parent) return null;
      const index = structuralChildren(parent).indexOf(current);
      if (index < 0) return null;
      path.unshift(index);
      current = parent;
    }
    return current === wrapper ? path : null;
  };

  const elementAtPath = (path: number[]): Element | null => {
    let el: Element = wrapper;
    for (const index of path) {
      const kid = structuralChildren(el)[index];
      if (!kid) return null;
      el = kid;
    }
    return el;
  };

  const charOffsetWithin = (root: Element, node: Node, offsetInNode: number): number => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current === node) return total + offsetInNode;
      total += current.textContent?.length ?? 0;
    }
    return total;
  };

  const resolveCharOffset = (
    root: Element,
    charOffset: number,
  ): { node: Text; offset: number } | null => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = charOffset;
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      const length = current.textContent?.length ?? 0;
      if (remaining <= length) return { node: current as Text, offset: remaining };
      remaining -= length;
    }
    return null;
  };

  const nearestElement = (node: Node): Element | null => {
    let el = node instanceof Element ? node : node.parentElement;
    // Climb out of overlay marks so boundaries anchor to real structure.
    while (el && el !== wrapper && isOverlayMark(el)) el = el.parentElement;
    return el;
  };

  const serializeSelection = (): HighlightRange | null => {
    // Chromium exposes in-shadow selections via the shadow root; fall back
    // to the document selection elsewhere.
    const shadowSelection = (
      shadow as unknown as { getSelection?: () => Selection | null }
    ).getSelection?.();
    const selection = shadowSelection ?? document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!wrapper.contains(range.startContainer) || !wrapper.contains(range.endContainer)) {
      return null;
    }
    const startEl = nearestElement(range.startContainer);
    const endEl = nearestElement(range.endContainer);
    if (!startEl || !endEl) return null;
    const startPath = elementPathOf(startEl);
    const endPath = elementPathOf(endEl);
    if (!startPath || !endPath) return null;
    const text = range.toString().replace(/\s+/g, ' ').trim();
    if (text.length === 0) return null;
    return {
      startPath,
      startOffset: charOffsetWithin(startEl, range.startContainer, range.startOffset),
      endPath,
      endOffset: charOffsetWithin(endEl, range.endContainer, range.endOffset),
      text: text.slice(0, 5000),
    };
  };

  const applyHighlight = (id: string, hl: HighlightRange, hasNote: boolean): boolean => {
    const startEl = elementAtPath(hl.startPath);
    const endEl = elementAtPath(hl.endPath);
    if (!startEl || !endEl) return false;
    const start = resolveCharOffset(startEl, hl.startOffset);
    const end = resolveCharOffset(endEl, hl.endOffset);
    if (!start || !end) return false;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed) return false;

    // Wrap every text-node intersection separately; a single surroundContents
    // fails as soon as the range crosses element boundaries.
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range.intersectsNode(node)) nodes.push(node as Text);
    }
    let wrapped = false;
    for (const node of nodes) {
      const from = node === start.node ? start.offset : 0;
      const to = node === end.node ? end.offset : (node.textContent?.length ?? 0);
      if (from >= to) continue;
      const segment = document.createRange();
      segment.setStart(node, from);
      segment.setEnd(node, to);
      const mark = document.createElement('mark');
      mark.className = hasNote ? 'hl has-note' : 'hl';
      mark.dataset.hlId = id;
      try {
        segment.surroundContents(mark);
        wrapped = true;
      } catch {
        // skip un-wrappable segments rather than failing the whole highlight
      }
    }
    return wrapped;
  };

  const removeHighlight = (id: string): void => {
    for (const mark of Array.from(wrapper.querySelectorAll(`mark.hl[data-hl-id="${id}"]`))) {
      const parent = mark.parentNode;
      while (mark.firstChild) parent?.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent?.normalize();
    }
  };

  const setNoteFlag = (id: string, hasNote: boolean): void => {
    for (const mark of Array.from(wrapper.querySelectorAll(`mark.hl[data-hl-id="${id}"]`))) {
      mark.classList.toggle('has-note', hasNote);
    }
  };

  const scrollToHighlight = (id: string): boolean => {
    const mark = wrapper.querySelector(`mark.hl[data-hl-id="${id}"]`);
    if (!mark) return false;
    if (isPaged()) snapToPage(absoluteStart(mark, mount, 'h'));
    else mount.scrollTop = Math.max(absoluteStart(mark, mount, 'v') - 80, 0);
    return true;
  };

  const findAndMark = (term: string): boolean => {
    // Clear any previous hit so repeated finds don't accumulate marks.
    for (const previous of Array.from(wrapper.querySelectorAll('mark.find-hit'))) {
      const parent = previous.parentNode;
      while (previous.firstChild) parent?.insertBefore(previous.firstChild, previous);
      previous.remove();
      parent?.normalize();
    }
    const needle = term.toLowerCase();
    if (needle.length === 0) return false;
    const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + term.length);
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      try {
        range.surroundContents(mark);
      } catch {
        return false;
      }
      if (isPaged()) snapToPage(absoluteStart(mark, mount, 'h'));
      else mount.scrollTop = Math.max(absoluteStart(mark, mount, 'v') - 80, 0);
      return true;
    }
    return false;
  };

  return {
    host,
    dispose,
    scrollToFragment,
    getScroll,
    setScroll,
    getAnchor,
    scrollToAnchor,
    textAt,
    pageInfo,
    pageBy,
    scrollToEnd,
    atEnd,
    chapterFraction,
    findAndMark,
    serializeSelection,
    applyHighlight,
    removeHighlight,
    setNoteFlag,
    scrollToHighlight,
  };
}

type Axis = 'v' | 'h';

// Highlight/find <mark> wrappers are presentation, not structure: locator
// paths (positions, bookmarks, highlights alike) must be computed as if they
// don't exist, or a locator captured in an already-marked paragraph
// serializes against the mutated DOM and never resolves again after reload.
function isOverlayMark(el: Element): boolean {
  return (
    el.tagName === 'MARK' && (el.classList.contains('hl') || el.classList.contains('find-hit'))
  );
}

function structuralChildren(el: Element): Element[] {
  const kids: Element[] = [];
  for (const kid of Array.from(el.children)) {
    if (isOverlayMark(kid)) continue; // overlay marks contain only text, never elements
    kids.push(kid);
  }
  return kids;
}

/** Element start offset (top or left) in the mount's scroll coordinates. */
function absoluteStart(el: Element, mount: HTMLElement, axis: Axis): number {
  const rect = el.getBoundingClientRect();
  const mountRect = mount.getBoundingClientRect();
  return axis === 'v'
    ? rect.top - mountRect.top + mount.scrollTop
    : rect.left - mountRect.left + mount.scrollLeft;
}

function boxSize(el: Element, axis: Axis): number {
  const rect = el.getBoundingClientRect();
  return axis === 'v' ? rect.height : rect.width;
}

function anchorFor(wrapper: HTMLElement, mount: HTMLElement, axis: Axis): PositionAnchor | null {
  const scrollPos = axis === 'v' ? mount.scrollTop : mount.scrollLeft;
  if (scrollPos <= 0) return { path: [], ratio: 0 };

  const path: number[] = [];
  let current: Element = wrapper;
  for (;;) {
    const kids = structuralChildren(current);
    // Prefer the kid whose box spans the viewport start; when it sits in a
    // margin/padding gap between blocks, anchor to the nearest following kid
    // (negative ratio) or, past the last block, to the last kid (ratio > 1).
    let spanning = -1;
    let following = -1;
    let last = -1;
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      if (!kid) continue;
      last = i;
      const start = absoluteStart(kid, mount, axis);
      if (start > scrollPos) {
        following = i;
        break;
      }
      if (start + boxSize(kid, axis) > scrollPos) {
        spanning = i;
        break;
      }
    }
    if (spanning >= 0) {
      const next = kids[spanning];
      if (!next) break;
      path.push(spanning);
      current = next;
      if (current.children.length === 0) break;
      continue;
    }
    const fallback = following >= 0 ? following : last;
    const next = fallback >= 0 ? kids[fallback] : undefined;
    if (next) {
      path.push(fallback);
      current = next;
    }
    break;
  }

  if (path.length === 0) return { path: [], ratio: 0 };
  const size = boxSize(current, axis);
  const ratio = size > 0 ? (scrollPos - absoluteStart(current, mount, axis)) / size : 0;
  return { path, ratio: Math.min(Math.max(ratio, -1), 2) };
}

/**
 * Resolve an anchor to a scroll offset along the given axis, or null for
 * "top of chapter". The anchor's path/ratio are axis-independent — captured
 * vertically they resolve horizontally and vice versa, which is what makes
 * positions survive display-mode switches.
 */
function anchorTarget(
  wrapper: HTMLElement,
  mount: HTMLElement,
  anchor: PositionAnchor,
  axis: Axis,
): number | null {
  let el: Element = wrapper;
  for (const index of anchor.path) {
    const kid = structuralChildren(el)[index];
    if (!kid) break;
    el = kid;
  }
  if (el === wrapper) return null;
  // Cross-axis capture ratios can overshoot; keep restore inside the element.
  const ratio = Math.min(Math.max(anchor.ratio, 0), 1);
  return absoluteStart(el, mount, axis) + ratio * boxSize(el, axis);
}

export function applyOptions(host: HTMLElement, options: RenderOptions): void {
  host.style.setProperty('--reader-font-scale', String(options.fontScale));
  const theme = THEMES[options.theme];
  host.style.setProperty('--reader-bg', theme.bg);
  host.style.setProperty('--reader-fg', theme.fg);
  host.style.setProperty('--reader-link', theme.link);
  host.style.setProperty('--reader-muted', theme.muted);
  host.style.setProperty('--reader-mark', theme.mark);
  host.style.setProperty('--reader-measure', MEASURES[options.measure]);
  host.style.setProperty('--reader-leading', LEADINGS[options.leading]);
  host.dataset.mode = options.mode;
  if (options.mode === 'paged') {
    // Column stride must equal the visible width: column + gap = clientWidth,
    // with the wrapper's side padding folded into the gap. The column itself
    // is capped at the chosen measure so a wide window reads like a book
    // page, not a banner — the surplus becomes symmetric margins.
    const mount = host.parentElement;
    const viewportWidth = mount?.clientWidth ?? 800;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const measurePx = Number.parseFloat(MEASURES[options.measure]) * rem * options.fontScale;
    const pad = Math.max(PAGE_GUTTER, Math.floor((viewportWidth - measurePx) / 2));
    const width = Math.max(viewportWidth - pad * 2, 240);
    host.style.setProperty('--reader-col-w', `${width}px`);
    host.style.setProperty('--reader-page-pad', `${pad}px`);
  }
}

function makeStub(host: HTMLElement): RenderedChapter {
  return {
    host,
    dispose: (): void => host.remove(),
    scrollToFragment: (): void => {},
    getScroll: (): number => 0,
    setScroll: (): void => {},
    getAnchor: (): PositionAnchor | null => null,
    scrollToAnchor: (): void => {},
    textAt: (): string | null => null,
    pageInfo: (): { page: number; pages: number } => ({ page: 1, pages: 1 }),
    pageBy: (): boolean => false,
    scrollToEnd: (): void => {},
    atEnd: (): boolean => false,
    chapterFraction: (): number => 0,
    findAndMark: (): boolean => false,
    serializeSelection: (): HighlightRange | null => null,
    applyHighlight: (): boolean => false,
    removeHighlight: (): void => {},
    setNoteFlag: (): void => {},
    scrollToHighlight: (): boolean => false,
  };
}

function adoptNode(target: Document, node: Node): Node {
  if (node.ownerDocument === target) return node;
  // adoptNode (unlike importNode) detaches the node from its source document,
  // so callers draining `body.firstChild` actually make progress.
  return target.adoptNode(node);
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

// Mirrors the app-chrome tokens in styles.css — change them together.
const THEMES: Record<
  RenderOptions['theme'],
  { bg: string; fg: string; link: string; muted: string; mark: string }
> = {
  light: {
    bg: '#f5f4ef',
    fg: '#24211b',
    link: '#33518a',
    muted: '#6e6759',
    mark: 'rgba(240, 210, 100, 0.45)',
  },
  sepia: {
    bg: '#f1e8d5',
    fg: '#443929',
    link: '#4f618e',
    muted: '#7c6d52',
    mark: 'rgba(214, 170, 60, 0.4)',
  },
  dark: {
    bg: '#16140f',
    fg: '#d9d3c5',
    link: '#94b0e0',
    muted: '#96907e',
    mark: 'rgba(228, 190, 80, 0.26)',
  },
};

const PAGE_GUTTER = 48;

const MEASURES: Record<TypoStep, string> = { s: '32rem', m: '38rem', l: '46rem' };
const LEADINGS: Record<TypoStep, string> = { s: '1.45', m: '1.65', l: '1.85' };

const SHADOW_BASE_CSS = `
  :host {
    --reader-font-scale: 1;
    --reader-bg: #f5f4ef;
    --reader-fg: #24211b;
    --reader-link: #33518a;
    --reader-muted: #6e6759;
    --reader-mark: rgba(240, 210, 100, 0.45);
    --reader-measure: 38rem;
    --reader-leading: 1.65;
    display: block;
    color: var(--reader-fg);
    background: var(--reader-bg);
  }
  ::selection { background: var(--reader-mark); }
  mark.find-hit { background: var(--reader-mark); color: inherit; padding: 0 0.1em; border-radius: 2px; }
  mark.hl { background: var(--reader-mark); color: inherit; padding: 0 0.05em; border-radius: 2px; cursor: pointer; }
  mark.hl.has-note { border-bottom: 1.5px dashed var(--reader-link); }
  .reader-chapter {
    max-width: var(--reader-measure);
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
    font-family: 'Charter', 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
    font-size: calc(1.05rem * var(--reader-font-scale));
    line-height: var(--reader-leading);
  }
  :host([data-mode='paged']) {
    height: 100%;
    /* Columns must overflow the host horizontally so the viewport (the
       scroll container, overflow:hidden) gains scrollWidth to page through. */
  }
  :host([data-mode='paged']) .reader-chapter {
    box-sizing: border-box;
    height: 100%;
    max-width: none;
    margin: 0;
    padding: 2.5rem var(--reader-page-pad, ${PAGE_GUTTER}px);
    column-width: var(--reader-col-w, 640px);
    column-gap: calc(var(--reader-page-pad, ${PAGE_GUTTER}px) * 2);
    column-fill: auto;
  }
  .reader-chapter p { margin: 0 0 1em; }
  .reader-chapter h1, .reader-chapter h2, .reader-chapter h3, .reader-chapter h4 {
    font-family: inherit;
    line-height: 1.25;
    margin: 1.6em 0 0.6em;
    text-wrap: balance;
  }
  .reader-chapter h1 { font-size: calc(1.7rem * var(--reader-font-scale)); }
  .reader-chapter h2 { font-size: calc(1.35rem * var(--reader-font-scale)); }
  .reader-chapter h3 { font-size: calc(1.15rem * var(--reader-font-scale)); }
  .reader-chapter a {
    color: var(--reader-link);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.15em;
  }
  .reader-chapter blockquote {
    border-left: 2px solid var(--reader-link);
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
