// EPUB OPF + container + nav parsing.
//
// EPUBs are OCF zips with:
//   META-INF/container.xml -> points at the OPF "rootfile"
//   <opf>.opf             -> manifest (id -> href + media-type) + spine (reading order) + metadata
//   nav xhtml in manifest -> EPUB3 nav doc (properties="nav") with <nav epub:type="toc">
//
// We use the browser DOMParser. XHTML/XML inside an EPUB is well-formed by spec.

import { resolveAgainst, splitFragment } from './path.ts';
import type { BookMetadata, Chapter, TocEntry } from './types.ts';

const NS_CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container';
const NS_OPF = 'http://www.idpf.org/2007/opf';
const NS_DC = 'http://purl.org/dc/elements/1.1/';
const NS_XHTML = 'http://www.w3.org/1999/xhtml';

export interface OpfData {
  /** Path of the OPF file inside the EPUB. */
  opfPath: string;
  metadata: BookMetadata;
  /** Manifest items keyed by id. */
  manifest: Map<string, ManifestItem>;
  /** Spine = ordered list of manifest ids. */
  spine: string[];
  /** id of the EPUB3 nav doc, if any. */
  navId: string | null;
  /** id of the EPUB2 ncx doc, if any. */
  ncxId: string | null;
}

export interface ManifestItem {
  id: string;
  /** Path inside the EPUB, normalized. */
  path: string;
  mediaType: string;
  properties: string[];
}

export function parseContainer(xml: string): { rootfilePath: string } {
  const doc = parseXml(xml);
  const rootfile = firstChildNS(doc.documentElement, NS_CONTAINER, 'rootfiles');
  if (!rootfile) throw new Error('epub: container.xml has no <rootfiles>');
  const first = firstChildNS(rootfile, NS_CONTAINER, 'rootfile');
  if (!first) throw new Error('epub: container.xml has no <rootfile>');
  const path = first.getAttribute('full-path');
  if (!path) throw new Error('epub: <rootfile> missing full-path');
  return { rootfilePath: path };
}

export function parseOpf(xml: string, opfPath: string): OpfData {
  const doc = parseXml(xml);
  const root = doc.documentElement;

  const metadataEl = firstChildNS(root, NS_OPF, 'metadata');
  const manifestEl = firstChildNS(root, NS_OPF, 'manifest');
  const spineEl = firstChildNS(root, NS_OPF, 'spine');
  if (!metadataEl || !manifestEl || !spineEl) {
    throw new Error('epub: OPF missing metadata/manifest/spine');
  }

  const metadata: BookMetadata = {
    title: dcText(metadataEl, 'title') ?? 'Untitled',
    author: dcText(metadataEl, 'creator') ?? 'Unknown',
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
  let ncxId: string | null = spineEl.getAttribute('toc');
  for (const ref of childrenNS(spineEl, NS_OPF, 'itemref')) {
    const idref = ref.getAttribute('idref');
    if (!idref) continue;
    if ((ref.getAttribute('linear') ?? 'yes') === 'no') continue;
    spine.push(idref);
  }
  if (ncxId && !manifest.has(ncxId)) ncxId = null;

  return { opfPath, metadata, manifest, spine, navId, ncxId };
}

export function buildChapters(opf: OpfData): Chapter[] {
  const out: Chapter[] = [];
  for (let i = 0; i < opf.spine.length; i++) {
    const id = opf.spine[i];
    if (id === undefined) continue;
    const item = opf.manifest.get(id);
    if (!item) continue;
    out.push({
      index: i,
      id: item.id,
      href: item.path,
      path: item.path,
      mediaType: item.mediaType,
      title: null,
    });
  }
  return out;
}

/**
 * Parse EPUB3 nav doc. Walks the first `<nav epub:type="toc">` and extracts
 * its `<ol>` tree.
 */
export function parseNav(xml: string, navPath: string): TocEntry[] {
  const doc = parseXml(xml);
  const navs = doc.getElementsByTagNameNS(NS_XHTML, 'nav');
  let target: Element | null = null;
  for (let i = 0; i < navs.length; i++) {
    const nav = navs.item(i);
    if (!nav) continue;
    // epub:type lives in the EPUB ops namespace; some files leave it unprefixed.
    const epubType =
      nav.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? nav.getAttribute('epub:type');
    if (epubType === 'toc') {
      target = nav;
      break;
    }
  }
  if (!target) target = navs.item(0);
  if (!target) return [];
  const ol = firstChildNS(target, NS_XHTML, 'ol');
  if (!ol) return [];
  return readOl(ol, navPath);
}

function readOl(ol: Element, navPath: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const li of childrenNS(ol, NS_XHTML, 'li')) {
    const a = firstChildNS(li, NS_XHTML, 'a') ?? firstChildNS(li, NS_XHTML, 'span');
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
    const childOl = firstChildNS(li, NS_XHTML, 'ol');
    const children = childOl ? readOl(childOl, navPath) : [];
    entries.push({ label, path, fragment, children });
  }
  return entries;
}

/**
 * Fallback EPUB2 NCX parser. Only used when nav doc is absent.
 */
export function parseNcx(xml: string, ncxPath: string): TocEntry[] {
  const doc = parseXml(xml);
  const navMap = doc.getElementsByTagName('navMap').item(0);
  if (!navMap) return [];
  return readNavPoints(navMap, ncxPath);
}

function readNavPoints(parent: Element, ncxPath: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.localName !== 'navPoint') continue;
    const labelEl = child.getElementsByTagName('text').item(0);
    const contentEl = child.getElementsByTagName('content').item(0);
    const label = (labelEl?.textContent ?? '').trim();
    const src = contentEl?.getAttribute('src') ?? '';
    const split = splitFragment(decodeURI(src));
    const path = src.length > 0 ? resolveAgainst(ncxPath, split.path) : '';
    entries.push({
      label,
      path,
      fragment: split.fragment,
      children: readNavPoints(child, ncxPath),
    });
  }
  return entries;
}

// --- helpers ---

function parseXml(xml: string): Document {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror').item(0);
  if (error) throw new Error(`epub: xml parse error — ${error.textContent ?? ''}`);
  return doc;
}

function firstChildNS(parent: Element, ns: string, local: string): Element | null {
  const children = parent.getElementsByTagNameNS(ns, local);
  return children.item(0);
}

function childrenNS(parent: Element, ns: string, local: string): Element[] {
  // Direct children only (avoid descendants from nested manifests).
  const out: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.namespaceURI === ns && child.localName === local) out.push(child);
  }
  return out;
}

function dcText(metadata: Element, local: string): string | null {
  const els = metadata.getElementsByTagNameNS(NS_DC, local);
  const first = els.item(0);
  const text = first?.textContent?.trim();
  return text && text.length > 0 ? text : null;
}
