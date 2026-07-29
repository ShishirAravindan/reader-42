// EPUB OCF/OPF/nav parsing.
//
//   META-INF/container.xml  -> points at the OPF "rootfile"
//   <opf>.opf               -> manifest (id -> href + media-type), spine (reading order), metadata
//   nav xhtml               -> EPUB3 nav doc (properties="nav") with <nav epub:type="toc">
//   toc.ncx                 -> EPUB2 fallback when no nav doc exists
//
// Wild EPUBs deviate reliably: epub:type is sometimes unprefixed, hrefs arrive
// URI-encoded, linear="no" spine items must be skipped, and the spine's toc
// attribute may point at a missing NCX. Everything here is namespace-aware
// because chapters and nav docs are XHTML, where getElementsByTagName misses.

import { resolveAgainst, splitFragment } from './path.ts';
import type { BookMetadata, Chapter, TocEntry } from './types.ts';

const NS_CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container';
const NS_OPF = 'http://www.idpf.org/2007/opf';
const NS_DC = 'http://purl.org/dc/elements/1.1/';
const NS_XHTML = 'http://www.w3.org/1999/xhtml';
const NS_EPUB_OPS = 'http://www.idpf.org/2007/ops';

export interface OpfData {
  opfPath: string;
  metadata: BookMetadata;
  manifest: Map<string, ManifestItem>;
  /** Ordered manifest ids; linear="no" items already skipped. */
  spine: string[];
  /** Spine page-progression-direction; null when absent or "default". */
  pageProgression: 'ltr' | 'rtl' | null;
  navId: string | null;
  ncxId: string | null;
}

export interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

export function parseContainer(xml: string): { rootfilePath: string } {
  const doc = parseXml(xml);
  const rootfiles = firstDescendantNS(doc.documentElement, NS_CONTAINER, 'rootfiles');
  if (!rootfiles) throw new Error('epub: container.xml has no <rootfiles>');
  const first = firstDescendantNS(rootfiles, NS_CONTAINER, 'rootfile');
  if (!first) throw new Error('epub: container.xml has no <rootfile>');
  const path = first.getAttribute('full-path');
  if (!path) throw new Error('epub: <rootfile> missing full-path');
  return { rootfilePath: path };
}

export function parseOpf(xml: string, opfPath: string): OpfData {
  const doc = parseXml(xml);
  const root = doc.documentElement;

  const metadataEl = firstDescendantNS(root, NS_OPF, 'metadata');
  const manifestEl = firstDescendantNS(root, NS_OPF, 'manifest');
  const spineEl = firstDescendantNS(root, NS_OPF, 'spine');
  if (!metadataEl || !manifestEl || !spineEl) {
    throw new Error('epub: OPF missing metadata/manifest/spine');
  }

  const metadata: BookMetadata = {
    title: dcText(metadataEl, 'title') ?? 'Untitled',
    author: dcText(metadataEl, 'creator'),
    language: dcText(metadataEl, 'language'),
    identifier: dcText(metadataEl, 'identifier'),
  };

  const manifest = new Map<string, ManifestItem>();
  let navId: string | null = null;
  for (const item of childrenNS(manifestEl, NS_OPF, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') ?? 'application/octet-stream';
    if (!id || !href) continue;
    const properties = (item.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean);
    const path = resolveAgainst(opfPath, decodeURI(href));
    manifest.set(id, { id, path, mediaType, properties });
    if (properties.includes('nav')) navId = id;
  }

  const spine: string[] = [];
  const progression = spineEl.getAttribute('page-progression-direction');
  const pageProgression = progression === 'ltr' || progression === 'rtl' ? progression : null;
  let ncxId: string | null = spineEl.getAttribute('toc');
  for (const ref of childrenNS(spineEl, NS_OPF, 'itemref')) {
    const idref = ref.getAttribute('idref');
    if (!idref) continue;
    if ((ref.getAttribute('linear') ?? 'yes') === 'no') continue;
    spine.push(idref);
  }
  if (ncxId && !manifest.has(ncxId)) ncxId = null;

  return { opfPath, metadata, manifest, spine, pageProgression, navId, ncxId };
}

export function buildChapters(opf: OpfData): Chapter[] {
  const out: Chapter[] = [];
  for (const id of opf.spine) {
    const item = opf.manifest.get(id);
    if (!item) continue;
    out.push({ index: out.length, id: item.id, path: item.path, mediaType: item.mediaType });
  }
  return out;
}

/** Parse the EPUB3 nav doc: the first `<nav epub:type="toc">`, or any nav as fallback. */
export function parseNav(xml: string, navPath: string): TocEntry[] {
  const doc = parseXml(xml);
  const navs = doc.getElementsByTagNameNS(NS_XHTML, 'nav');
  let target: Element | null = null;
  for (let i = 0; i < navs.length; i++) {
    const nav = navs.item(i);
    if (!nav) continue;
    // epub:type lives in the ops namespace; some files leave it unprefixed.
    const epubType = nav.getAttributeNS(NS_EPUB_OPS, 'type') ?? nav.getAttribute('epub:type');
    if (epubType === 'toc') {
      target = nav;
      break;
    }
  }
  if (!target) target = navs.item(0);
  if (!target) return [];
  const ol = firstDescendantNS(target, NS_XHTML, 'ol');
  return ol ? readOl(ol, navPath) : [];
}

function readOl(ol: Element, navPath: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const li of childrenNS(ol, NS_XHTML, 'li')) {
    const a = firstDescendantNS(li, NS_XHTML, 'a') ?? firstDescendantNS(li, NS_XHTML, 'span');
    if (!a) continue;
    const label = (a.textContent ?? '').trim();
    const href = a.getAttribute('href') ?? '';
    let path = '';
    let fragment: string | null = null;
    if (href.length > 0) {
      const split = splitFragment(decodeURI(href));
      path = resolveAgainst(navPath, split.path);
      fragment = split.fragment;
    }
    const childOl = firstDescendantNS(li, NS_XHTML, 'ol');
    entries.push({ label, path, fragment, children: childOl ? readOl(childOl, navPath) : [] });
  }
  return entries;
}

/** EPUB2 NCX fallback, only used when no nav doc exists. */
export function parseNcx(xml: string, ncxPath: string): TocEntry[] {
  const doc = parseXml(xml);
  const navMap = doc.getElementsByTagName('navMap').item(0);
  return navMap ? readNavPoints(navMap, ncxPath) : [];
}

function readNavPoints(parent: Element, ncxPath: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.localName !== 'navPoint') continue;
    const label = (child.getElementsByTagName('text').item(0)?.textContent ?? '').trim();
    const src = child.getElementsByTagName('content').item(0)?.getAttribute('src') ?? '';
    const split = splitFragment(decodeURI(src));
    entries.push({
      label,
      path: src.length > 0 ? resolveAgainst(ncxPath, split.path) : '',
      fragment: split.fragment,
      children: readNavPoints(child, ncxPath),
    });
  }
  return entries;
}

// --- helpers ---

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror').item(0);
  if (error) throw new Error(`epub: xml parse error: ${error.textContent ?? ''}`);
  return doc;
}

function firstDescendantNS(parent: Element, ns: string, local: string): Element | null {
  return parent.getElementsByTagNameNS(ns, local).item(0);
}

function childrenNS(parent: Element, ns: string, local: string): Element[] {
  // Direct children only, so nested structures don't leak descendants in.
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) out.push(child);
  }
  return out;
}

function dcText(metadata: Element, local: string): string | null {
  const text = metadata.getElementsByTagNameNS(NS_DC, local).item(0)?.textContent?.trim();
  return text && text.length > 0 ? text : null;
}
