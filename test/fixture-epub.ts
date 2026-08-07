// Builds a small valid EPUB in memory: a STORED-only zip writer plus fixture
// content. Used by unit tests and by demo scripts (run directly to write one
// to disk: `bun test/fixture-epub.ts /tmp/fixture.epub`).

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface StoredEntry {
  name: string;
  bytes: Uint8Array;
  offset: number;
  crc: number;
}

/** Minimal STORED-only zip writer, enough to make valid EPUBs for tests. */
export function buildZip(files: [name: string, content: string | Uint8Array][]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const entries: StoredEntry[] = [];
  let offset = 0;

  const push = (chunk: Uint8Array): void => {
    chunks.push(chunk);
    offset += chunk.byteLength;
  };

  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const bytes = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(bytes);
    entries.push({ name, bytes, offset, crc });

    const lfh = new DataView(new ArrayBuffer(30));
    lfh.setUint32(0, 0x04034b50, true);
    lfh.setUint16(4, 20, true); // version needed
    lfh.setUint16(8, 0, true); // method: stored
    lfh.setUint32(14, crc, true);
    lfh.setUint32(18, bytes.byteLength, true);
    lfh.setUint32(22, bytes.byteLength, true);
    lfh.setUint16(26, nameBytes.byteLength, true);
    push(new Uint8Array(lfh.buffer));
    push(nameBytes);
    push(bytes);
  }

  const cdStart = offset;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const cdh = new DataView(new ArrayBuffer(46));
    cdh.setUint32(0, 0x02014b50, true);
    cdh.setUint16(4, 20, true);
    cdh.setUint16(6, 20, true);
    cdh.setUint16(10, 0, true); // stored
    cdh.setUint32(16, entry.crc, true);
    cdh.setUint32(20, entry.bytes.byteLength, true);
    cdh.setUint32(24, entry.bytes.byteLength, true);
    cdh.setUint16(28, nameBytes.byteLength, true);
    cdh.setUint32(42, entry.offset, true);
    push(new Uint8Array(cdh.buffer));
    push(nameBytes);
  }
  const cdSize = offset - cdStart;

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdStart, true);
  push(new Uint8Array(eocd.buffer));

  const out = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return out;
}

const xhtml = (title: string, body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title>
<link rel="stylesheet" href="style.css"/></head><body>${body}</body></html>`;

const longChapter = (): string => {
  const paras: string[] = [];
  for (let i = 1; i <= 60; i++) {
    paras.push(
      `<p id="p${i}">Paragraph ${i}. The quick brown fox jumps over the lazy dog, deliberately and at length, so that this chapter scrolls far past a single viewport and position anchors have real work to do.</p>`,
    );
  }
  return paras.join('\n');
};

export function buildFixtureEpub(): Uint8Array {
  return buildZip([
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    ],
    [
      'OEBPS/content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">fixture-42</dc:identifier>
    <dc:title>The Fixture of Everything</dc:title>
    <dc:creator>A. Test Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>`,
    ],
    [
      'OEBPS/nav.xhtml',
      xhtml(
        'Contents',
        `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol>
          <li><a href="ch1.xhtml">One: A Beginning</a></li>
          <li><a href="ch2.xhtml">Two: The Long Middle</a>
            <ol><li><a href="ch2.xhtml#p30">Deep in the middle</a></li></ol></li>
          <li><a href="ch3.xhtml">Three: An End</a></li>
        </ol></nav>
        <nav epub:type="page-list" xmlns:epub="http://www.idpf.org/2007/ops" hidden="hidden"><ol>
          <li><a href="ch1.xhtml#c1">1</a></li>
          <li><a href="ch2.xhtml#p1">2</a></li>
          <li><a href="ch2.xhtml#p20">3</a></li>
          <li><a href="ch2.xhtml#p40">4</a></li>
          <li><a href="ch2.xhtml#p55">5</a></li>
          <li><a href="ch3.xhtml#c3">6</a></li>
        </ol></nav>`,
      ),
    ],
    ['OEBPS/style.css', 'em { font-style: italic; } .fancy { color: inherit; }'],
    [
      'OEBPS/ch1.xhtml',
      xhtml(
        'One',
        // The noteref + trailing aside is the shape real EPUB3 books use for
        // footnotes (H2): the marker sits inline, the note lives at the foot
        // of the chapter, and epub:type says what each one is.
        `<h1 id="c1">One: A Beginning</h1><p>The first chapter is short. It links ahead to <a href="ch3.xhtml">the end</a> so internal navigation has something to do.</p>
         <p id="fnp">Some claims want support<a epub:type="noteref" xmlns:epub="http://www.idpf.org/2007/ops" href="#fn1" id="nr1"><sup>1</sup></a> before a reader will take them.</p>
         <aside epub:type="footnote" xmlns:epub="http://www.idpf.org/2007/ops" id="fn1"><p>Marginalia belongs at the foot of the page, where it can be ignored.</p></aside>`,
      ),
    ],
    ['OEBPS/ch2.xhtml', xhtml('Two', `<h1>Two: The Long Middle</h1>\n${longChapter()}`)],
    [
      'OEBPS/ch3.xhtml',
      xhtml(
        'Three',
        '<h1 id="c3">Three: An End</h1><p>It ends, as chapters do, <em>quietly</em>.</p>',
      ),
    ],
  ]);
}

if (import.meta.main) {
  const target = process.argv[2];
  if (!target) throw new Error('usage: bun test/fixture-epub.ts <out.epub>');
  await Bun.write(target, buildFixtureEpub().slice());
  console.log(`wrote ${target}`);
}
