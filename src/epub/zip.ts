// Minimal ZIP reader for EPUB needs.
//
// Supports STORED (method 0) and DEFLATE (method 8, via DecompressionStream)
// with a standard 32-bit central directory. No ZIP64, no encryption, no
// multi-disk: EPUBs are small in practice. Reference: PKWARE APPNOTE 6.3.x
// (sections 4.3.6, 4.3.12, 4.3.16).

const SIG_LFH = 0x04034b50; // local file header
const SIG_CDH = 0x02014b50; // central directory header
const SIG_EOCD = 0x06054b50; // end of central directory

export interface ZipEntry {
  name: string;
  size: number;
  method: number;
  localHeaderOffset: number;
  compressedSize: number;
}

export class Zip {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private readonly entries: Map<string, ZipEntry>;

  private constructor(bytes: Uint8Array, entries: Map<string, ZipEntry>) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.entries = entries;
  }

  static async open(input: ArrayBuffer | Uint8Array): Promise<Zip> {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocd = findEocd(view, bytes.byteLength);
    if (eocd < 0) throw new Error('zip: end-of-central-directory not found');

    const cdEntries = view.getUint16(eocd + 10, true);
    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    const entries = new Map<string, ZipEntry>();

    let cursor = cdOffset;
    const cdEnd = cdOffset + cdSize;
    for (let i = 0; i < cdEntries; i++) {
      if (cursor + 46 > cdEnd) throw new Error('zip: truncated central directory');
      const sig = view.getUint32(cursor, true);
      if (sig !== SIG_CDH) throw new Error(`zip: bad CDH signature at ${cursor}`);
      const method = view.getUint16(cursor + 10, true);
      const compressedSize = view.getUint32(cursor + 20, true);
      const uncompressedSize = view.getUint32(cursor + 24, true);
      const nameLen = view.getUint16(cursor + 28, true);
      const extraLen = view.getUint16(cursor + 30, true);
      const commentLen = view.getUint16(cursor + 32, true);
      const localHeaderOffset = view.getUint32(cursor + 42, true);
      const name = decodeUtf8(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
      entries.set(name, {
        name,
        size: uncompressedSize,
        method,
        localHeaderOffset,
        compressedSize,
      });
      cursor += 46 + nameLen + extraLen + commentLen;
    }

    return new Zip(bytes, entries);
  }

  list(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Read a file's raw bytes. Throws if not found. */
  async read(name: string): Promise<Uint8Array> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`zip: missing entry ${name}`);
    const dataOffset = this.findDataOffset(entry);
    const compressed = this.bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    if (entry.method === 0) return compressed.slice();
    if (entry.method === 8) return await inflateRaw(compressed);
    throw new Error(`zip: unsupported method ${entry.method} for ${name}`);
  }

  async readText(name: string): Promise<string> {
    return decodeUtf8(await this.read(name));
  }

  private findDataOffset(entry: ZipEntry): number {
    const off = entry.localHeaderOffset;
    if (off + 30 > this.bytes.byteLength) throw new Error('zip: truncated LFH');
    if (this.view.getUint32(off, true) !== SIG_LFH) throw new Error('zip: bad LFH signature');
    const nameLen = this.view.getUint16(off + 26, true);
    const extraLen = this.view.getUint16(off + 28, true);
    return off + 30 + nameLen + extraLen;
  }
}

function findEocd(view: DataView, length: number): number {
  // EOCD sits at the end; a zip comment may pad up to 65535 bytes after it.
  const max = Math.min(length, 0xffff + 22);
  for (let i = length - 22; i >= length - max && i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([compressed.slice()]).stream();
  const decompressed = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const chunks: Uint8Array[] = [];
  const reader = decompressed.getReader();
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}
