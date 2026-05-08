// Public EPUB loader. `loadEpub` returns a `Book` keyed by content hash.

import type { Book, Chapter, Resource, TocEntry } from './types.ts';
import { Zip } from './zip.ts';
import { buildChapters, parseContainer, parseNav, parseNcx, parseOpf } from './parser.ts';

export type { Book, Chapter, Resource, TocEntry, BookMetadata } from './types.ts';

const CONTAINER_PATH = 'META-INF/container.xml';

export async function loadEpub(input: File | ArrayBuffer | Uint8Array): Promise<Book> {
  const bytes = await toBytes(input);
  const id = await sha256Hex(bytes);
  const zip = await Zip.open(bytes);

  if (!zip.has(CONTAINER_PATH)) {
    throw new Error(`epub: missing ${CONTAINER_PATH}`);
  }
  const containerXml = await zip.readText(CONTAINER_PATH);
  const { rootfilePath } = parseContainer(containerXml);

  if (!zip.has(rootfilePath)) {
    throw new Error(`epub: rootfile not in archive: ${rootfilePath}`);
  }
  const opfXml = await zip.readText(rootfilePath);
  const opf = parseOpf(opfXml, rootfilePath);

  const chapters = buildChapters(opf);

  let toc: TocEntry[] = [];
  if (opf.navId !== null) {
    const navItem = opf.manifest.get(opf.navId);
    if (navItem && zip.has(navItem.path)) {
      const navXml = await zip.readText(navItem.path);
      try {
        toc = parseNav(navXml, navItem.path);
      } catch {
        toc = [];
      }
    }
  }
  if (toc.length === 0 && opf.ncxId !== null) {
    const ncxItem = opf.manifest.get(opf.ncxId);
    if (ncxItem && zip.has(ncxItem.path)) {
      const ncxXml = await zip.readText(ncxItem.path);
      try {
        toc = parseNcx(ncxXml, ncxItem.path);
      } catch {
        toc = [];
      }
    }
  }

  decorateChapterTitles(chapters, toc);

  // Eagerly load every manifest item into memory. EPUBs are small enough
  // (typically < 5MB) that this avoids re-decompressing on every image.
  const resources = new Map<string, Resource>();
  for (const item of opf.manifest.values()) {
    if (!zip.has(item.path)) continue;
    const data = await zip.read(item.path);
    resources.set(item.path, { path: item.path, mediaType: item.mediaType, bytes: data });
  }

  return {
    id,
    metadata: opf.metadata,
    chapters,
    toc,
    resolveResource(path: string): Resource | null {
      return resources.get(path) ?? null;
    },
  };
}

function decorateChapterTitles(chapters: Chapter[], toc: TocEntry[]): void {
  const titleByPath = new Map<string, string>();
  const walk = (entries: TocEntry[]): void => {
    for (const entry of entries) {
      if (entry.path && entry.label && !titleByPath.has(entry.path)) {
        titleByPath.set(entry.path, entry.label);
      }
      walk(entry.children);
    }
  };
  walk(toc);
  for (const ch of chapters) {
    const t = titleByPath.get(ch.path);
    if (t) ch.title = t;
  }
}

async function toBytes(input: File | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  // File / Blob
  return new Uint8Array(await input.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Always produce a deterministic 16-char prefix to keep storage keys short.
  const ab = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : bytes.slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', ab);
  const view = new Uint8Array(digest);
  let hex = '';
  for (const b of view) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, 16);
}
