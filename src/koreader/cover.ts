// The cover image, out of an EPUB, without opening the book.
//
// A shelf that is the product needs covers, and needs them for a folder of
// books at once — so this reads the OPF and one image entry rather than
// decompressing the whole archive the way Book.open does.
//
// Publishers name the cover three different ways and all three are in the
// wild, so all three are tried in the order of how much they actually mean:
// the EPUB3 manifest property, the EPUB2 <meta name="cover"> pointer, then
// the filename guess that is right more often than it deserves to be.
//
// Belongs in src/epub/ if this shape is ever adopted; it lives here because a
// spike does not get to grow the shipped modules.

import { parseContainer, parseOpf } from '../epub/parser.ts';
import type { BookMetadata } from '../epub/types.ts';
import { Zip } from '../epub/zip.ts';

export interface CoverImage {
  bytes: Uint8Array;
  mediaType: string;
}

export interface BookFace {
  metadata: BookMetadata;
  cover: CoverImage | null;
  /** Spine length, so a shelf can say something about size without a full open. */
  chapters: number;
}

const IMAGE_TYPES = /^image\//;

/** Read title, author and cover from an EPUB's bytes. */
export async function readFace(bytes: Uint8Array): Promise<BookFace> {
  const zip = await Zip.open(bytes);
  const { rootfilePath } = parseContainer(await zip.readText('META-INF/container.xml'));
  const opf = parseOpf(await zip.readText(rootfilePath), rootfilePath);

  const candidates: string[] = [];

  // 1. EPUB3: the manifest item that says it is the cover.
  for (const item of opf.manifest.values()) {
    if (item.properties.includes('cover-image') && IMAGE_TYPES.test(item.mediaType)) {
      candidates.push(item.path);
    }
  }

  // 2. EPUB2: <meta name="cover" content="<manifest id>">.
  const metaId = coverMetaId(await zip.readText(rootfilePath));
  const byId = metaId ? opf.manifest.get(metaId) : undefined;
  if (byId && IMAGE_TYPES.test(byId.mediaType)) candidates.push(byId.path);

  // 3. The guess: an image whose name says cover. Last, and only images.
  for (const item of opf.manifest.values()) {
    if (IMAGE_TYPES.test(item.mediaType) && /cover/i.test(item.path)) candidates.push(item.path);
  }

  for (const path of candidates) {
    if (!zip.has(path)) continue;
    const item = [...opf.manifest.values()].find((entry) => entry.path === path);
    try {
      return {
        metadata: opf.metadata,
        cover: { bytes: await zip.read(path), mediaType: item?.mediaType ?? 'image/jpeg' },
        chapters: opf.spine.length,
      };
    } catch {
      // A cover that will not decompress is a book without a cover, not a
      // book that fails to appear on the shelf.
    }
  }

  return { metadata: opf.metadata, cover: null, chapters: opf.spine.length };
}

/** `<meta name="cover" content="...">`, the EPUB2 spelling. */
function coverMetaId(opfXml: string): string | null {
  const match = /<meta\b[^>]*\bname=["']cover["'][^>]*\bcontent=["']([^"']+)["']/i.exec(opfXml);
  if (match?.[1]) return match[1];
  const reversed = /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']cover["']/i.exec(opfXml);
  return reversed?.[1] ?? null;
}
