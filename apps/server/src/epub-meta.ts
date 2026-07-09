// Server-side EPUB metadata extraction: container.xml → OPF → dc:title / dc:creator.
//
// Deliberately regex-based: the server only needs two display fields plus
// proof that the file really is an EPUB (zip + mimetype + container + OPF).
// Full structural parsing stays in the reader, where DOMParser exists.

import { Zip } from '../../web/src/epub/zip.ts';

export interface EpubMeta {
  title: string | null;
  author: string | null;
}

export class InvalidEpubError extends Error {}

export async function readEpubMeta(bytes: Uint8Array): Promise<EpubMeta> {
  let zip: Zip;
  try {
    zip = await Zip.open(bytes);
  } catch (err) {
    throw new InvalidEpubError(`not a zip archive (${(err as Error).message})`);
  }

  if (zip.has('mimetype')) {
    const mimetype = (await zip.readText('mimetype')).trim();
    if (mimetype !== 'application/epub+zip') {
      throw new InvalidEpubError(`unexpected mimetype "${mimetype}"`);
    }
  }

  if (!zip.has('META-INF/container.xml')) {
    throw new InvalidEpubError('missing META-INF/container.xml');
  }
  const container = await zip.readText('META-INF/container.xml');
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath || !zip.has(opfPath)) {
    throw new InvalidEpubError('OPF package document not found');
  }

  const opf = await zip.readText(opfPath);
  return {
    title: firstTagText(opf, 'dc:title'),
    author: firstTagText(opf, 'dc:creator'),
  };
}

function firstTagText(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  const raw = match?.[1];
  if (!raw) return null;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, '').trim());
  return text.length > 0 ? text : null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
