// Generates apps/web/public/fixtures/test-book.epub.
//
// Self-contained: writes a minimal but spec-correct EPUB3 with three chapters,
// a nav doc, and an OPF. Uses STORED (uncompressed) entries so this script has
// zero external dependencies and is deterministic.
//
// Run with: bun run apps/web/scripts/build-fixture.ts

import { mkdirSync } from 'node:fs';

interface ZipFile {
  name: string;
  data: Uint8Array;
}

const enc = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

const MIMETYPE = 'application/epub+zip';

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:reader-42-fixture-0001</dc:identifier>
    <dc:title>The Test Volume</dc:title>
    <dc:creator>reader-42 fixtures</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-05-09T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
  </spine>
</package>
`;

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><meta charset="utf-8"/><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
        <li><a href="ch1.xhtml">Prologue</a></li>
        <li>
          <a href="ch2.xhtml">Chapter One: Of Inks and Initials</a>
          <ol>
            <li><a href="ch2.xhtml#scene-2">A Second Scene</a></li>
          </ol>
        </li>
        <li><a href="ch3.xhtml">Epilogue</a></li>
      </ol>
    </nav>
  </body>
</html>
`;

const CSS = `body { font-family: Georgia, serif; }
h1 { font-variant: small-caps; letter-spacing: 0.04em; }
em.first { font-style: italic; }
`;

const CH1 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><meta charset="utf-8"/><title>Prologue</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>Prologue</h1>
    <p>The volume opens, as so many volumes do, with a man at a window and a fog outside.</p>
    <p>This fixture exists to exercise the reader-42 EPUB pipeline end-to-end: parse the OPF, walk the spine, render chapter XHTML inside a sandboxed shadow root, and persist the reader's position across reloads.</p>
    <p>Use the &rarr; arrow key to advance.</p>
  </body>
</html>
`;

const CH2 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><meta charset="utf-8"/><title>Chapter One</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>Chapter One: Of Inks and Initials</h1>
    <p><em class="first">Ink</em>, in its proper element, is patient. It waits on the page until summoned by a hand, and then it remembers.</p>
    <h2 id="scene-2">A Second Scene</h2>
    <p>This is a deeper anchor target reached via the table-of-contents nested entry.</p>
    <p>A <a href="ch3.xhtml">forward link</a> walks to the epilogue, exercising intra-EPUB navigation.</p>
    <p>${'A line of small reading-test prose, set down in earnest. '.repeat(20)}</p>
  </body>
</html>
`;

const CH3 = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><meta charset="utf-8"/><title>Epilogue</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>Epilogue</h1>
    <p>Reach the epilogue and the v1 reader has done its job: spine traversal works, intra-EPUB anchors resolve, position memory will restore you here on reload.</p>
    <p><a href="ch1.xhtml">Return to the start</a>.</p>
  </body>
</html>
`;

const files: ZipFile[] = [
  { name: 'mimetype', data: enc.encode(MIMETYPE) },
  { name: 'META-INF/container.xml', data: enc.encode(CONTAINER_XML) },
  { name: 'OEBPS/content.opf', data: enc.encode(OPF) },
  { name: 'OEBPS/nav.xhtml', data: enc.encode(NAV) },
  { name: 'OEBPS/style.css', data: enc.encode(CSS) },
  { name: 'OEBPS/ch1.xhtml', data: enc.encode(CH1) },
  { name: 'OEBPS/ch2.xhtml', data: enc.encode(CH2) },
  { name: 'OEBPS/ch3.xhtml', data: enc.encode(CH3) },
];

const zip = buildZip(files);
mkdirSync(new URL('../public/fixtures/', import.meta.url), { recursive: true });
const out = new URL('../public/fixtures/test-book.epub', import.meta.url);
await Bun.write(out, zip);
console.log(`wrote ${out.pathname} (${zip.byteLength} bytes)`);

// --- minimal ZIP writer (STORED only) ----------------------------------------

function buildZip(entries: ZipFile[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.byteLength;

    const local = new Uint8Array(30 + nameBytes.byteLength + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method (stored)
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x21, true); // mod date — arbitrary fixed value
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.byteLength);
    localChunks.push(local);

    const central = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // method
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralChunks.push(central);

    offset += local.byteLength;
  }

  const cdSize = centralChunks.reduce((sum, c) => sum + c.byteLength, 0);
  const cdOffset = offset;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);

  let total = 0;
  for (const chunk of localChunks) total += chunk.byteLength;
  for (const chunk of centralChunks) total += chunk.byteLength;
  total += eocd.byteLength;

  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of localChunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  out.set(eocd, cursor);
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.byteLength; i++) {
    const byte = bytes[i] ?? 0;
    const tableValue = CRC_TABLE[(crc ^ byte) & 0xff] ?? 0;
    crc = (crc >>> 8) ^ tableValue;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
