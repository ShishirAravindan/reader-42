// Book identity and folder naming.
//
// A book's id is derived from its bytes, so the same EPUB imported twice is
// the same book everywhere: dedup, sync, and deep links all hang off this.
// The folder name puts a human-readable slug in front of the id because the
// library is meant to be browsed in a file manager, not just by code.

const ID_HEX_CHARS = 12;
const SLUG_MAX_CHARS = 40;

/** First 12 hex chars of sha256 over the EPUB bytes. */
export async function bookIdFromBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, ID_HEX_CHARS);
}

/** Lowercase, ascii-ish, hyphen-separated slug for folder names. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // strip combining marks left by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, '');
  return slug.length > 0 ? slug : 'untitled';
}

/** Folder for a book, relative to the library root. */
export function bookDir(title: string, id: string): string {
  return `books/${slugify(title)}-${id}`;
}
