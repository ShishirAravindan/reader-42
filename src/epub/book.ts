// The opened book: chapters in reading order, a table of contents, metadata,
// and synchronous resource lookup for the renderer.
//
// All archive entries are decompressed up front into a resource map. EPUBs
// are small, and a sync `resolveResource` keeps the renderer free of async
// waterfalls while it rewrites URLs.

import {
  buildChapters,
  parseContainer,
  parseNav,
  parseNcx,
  parseOpf,
  parsePageList,
} from './parser.ts';
import type { BookMetadata, Chapter, PageTarget, Resource, TocEntry } from './types.ts';
import { Zip } from './zip.ts';

export class Book {
  readonly metadata: BookMetadata;
  readonly chapters: Chapter[];
  readonly toc: TocEntry[];
  /** Print-edition page markers (parity B2); empty when the book has none. */
  readonly pageList: PageTarget[];
  /** Spine page-progression-direction; drives tap-zone/swipe mirroring. */
  readonly direction: 'ltr' | 'rtl';
  private readonly resources: Map<string, Resource>;

  private constructor(
    metadata: BookMetadata,
    chapters: Chapter[],
    toc: TocEntry[],
    pageList: PageTarget[],
    direction: 'ltr' | 'rtl',
    resources: Map<string, Resource>,
  ) {
    this.metadata = metadata;
    this.chapters = chapters;
    this.toc = toc;
    this.pageList = pageList;
    this.direction = direction;
    this.resources = resources;
  }

  static async open(bytes: Uint8Array): Promise<Book> {
    const zip = await Zip.open(bytes);
    const container = parseContainer(await zip.readText('META-INF/container.xml'));
    const opf = parseOpf(await zip.readText(container.rootfilePath), container.rootfilePath);
    const chapters = buildChapters(opf);
    if (chapters.length === 0) throw new Error('epub: spine has no readable chapters');

    const resources = new Map<string, Resource>();
    const mediaTypes = new Map<string, string>();
    for (const item of opf.manifest.values()) mediaTypes.set(item.path, item.mediaType);
    for (const name of zip.list()) {
      if (name.endsWith('/')) continue;
      resources.set(name, {
        path: name,
        mediaType: mediaTypes.get(name) ?? guessMediaType(name),
        bytes: await zip.read(name),
      });
    }

    let toc: TocEntry[] = [];
    let pageList: PageTarget[] = [];
    const navItem = opf.navId ? opf.manifest.get(opf.navId) : undefined;
    if (navItem && resources.has(navItem.path)) {
      toc = parseNav(text(resources, navItem.path), navItem.path);
      pageList = parsePageList(text(resources, navItem.path), navItem.path);
    } else {
      const ncxItem = opf.ncxId ? opf.manifest.get(opf.ncxId) : undefined;
      if (ncxItem && resources.has(ncxItem.path)) {
        toc = parseNcx(text(resources, ncxItem.path), ncxItem.path);
      }
    }

    return new Book(opf.metadata, chapters, toc, pageList, opf.pageProgression ?? 'ltr', resources);
  }

  resolveResource(path: string): Resource | null {
    return this.resources.get(path) ?? null;
  }

  /** Spine index of the chapter at an archive path, or -1. */
  chapterIndexByPath(path: string): number {
    return this.chapters.findIndex((c) => c.path === path);
  }

  /** Rough per-chapter weight (decompressed bytes) for length-honest progress. */
  chapterWeights(): number[] {
    return this.chapters.map((c) => this.resources.get(c.path)?.bytes.byteLength ?? 1);
  }
}

/** Read title/author without keeping the book open; used at import time. */
export async function readMetadata(bytes: Uint8Array): Promise<BookMetadata> {
  const zip = await Zip.open(bytes);
  const container = parseContainer(await zip.readText('META-INF/container.xml'));
  const opf = parseOpf(await zip.readText(container.rootfilePath), container.rootfilePath);
  return opf.metadata;
}

function text(resources: Map<string, Resource>, path: string): string {
  const res = resources.get(path);
  return res ? new TextDecoder().decode(res.bytes) : '';
}

function guessMediaType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const table: Record<string, string> = {
    xhtml: 'application/xhtml+xml',
    html: 'text/html',
    css: 'text/css',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ncx: 'application/x-dtbncx+xml',
    opf: 'application/oebps-package+xml',
  };
  return table[ext] ?? 'application/octet-stream';
}
