// Server-side plain-text extraction from an EPUB's spine, for the FTS index.
//
// Same regex-over-XML stance as epub-meta.ts: the server needs searchable
// prose per spine item, not a faithful DOM. The reader keeps real parsing.

import { Zip } from '../../web/src/epub/zip.ts';
import { decodeEntities } from './epub-meta.ts';

export interface ChapterText {
  index: number;
  title: string | null;
  text: string;
}

export async function readEpubText(bytes: Uint8Array): Promise<ChapterText[]> {
  const zip = await Zip.open(bytes);
  if (!zip.has('META-INF/container.xml')) return [];
  const container = await zip.readText('META-INF/container.xml');
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath || !zip.has(opfPath)) return [];

  const opf = await zip.readText(opfPath);
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const manifest = new Map<string, string>();
  for (const item of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = item[0];
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    if (id && href) manifest.set(id, href);
  }

  const chapters: ChapterText[] = [];
  let index = 0;
  for (const ref of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/gi)) {
    const spineIndex = index;
    index += 1;
    const idref = ref[1];
    const href = idref ? manifest.get(idref) : undefined;
    if (!href) continue;
    const path = decodeURI(opfDir + href).split('#')[0] ?? '';
    if (!zip.has(path)) continue;
    const xhtml = await zip.readText(path);
    chapters.push({
      index: spineIndex,
      title: chapterTitle(xhtml),
      text: htmlToText(xhtml),
    });
  }
  return chapters;
}

function chapterTitle(xhtml: string): string | null {
  const heading =
    xhtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
    xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (!heading) return null;
  const text = decodeEntities(heading.replace(/<[^>]+>/g, '').trim());
  return text.length > 0 ? text : null;
}

function htmlToText(xhtml: string): string {
  const body = xhtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? xhtml;
  return decodeEntities(
    body.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}
