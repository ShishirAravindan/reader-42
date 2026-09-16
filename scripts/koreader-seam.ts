// The seam, run against real files, reported honestly.
//
//   bun scripts/koreader-seam.ts --book <x.epub> --sidecar <metadata.epub.lua>
//                               [--library <dir>] [--export <out.md>]
//
// It answers one question: if KOReader is the reading surface and reader-42
// keeps the shelf and the plumbing to Logseq, how much of a reading session
// survives the crossing? The numbers it prints are the finding — the pass rate,
// and how often crengine's own chapter pointer was right. With --library it
// also writes a reader-42 library folder, which is what the acceptance scene
// and the recording then open.
//
// Nothing here is part of the shipped app. This is a spike (docs/koreader-poc.md).

import path from 'node:path';
import { JSDOM } from 'jsdom';
import { chapterTitles, logseqOutline, sortHighlights } from '../src/app/notebook.ts';
import { Book } from '../src/epub/book.ts';
import { type IngestReport, ingestSidecar } from '../src/koreader/ingest.ts';
import { Library } from '../src/library/store.ts';
import { FsTransport } from './demo/harness.ts';

// The EPUB parser needs a DOMParser; a plain `bun scripts/...` run has none.
// Same reason as test/setup.ts and showcase.ts.
(globalThis as { DOMParser?: unknown }).DOMParser ??= new JSDOM().window.DOMParser;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const bookPath = arg('book');
const sidecarPath = arg('sidecar');
if (!bookPath || !sidecarPath) {
  console.error(
    'usage: bun scripts/koreader-seam.ts --book <x.epub> --sidecar <metadata.epub.lua>',
  );
  process.exit(2);
}

const book = await Book.open(new Uint8Array(await Bun.file(bookPath).arrayBuffer()));
const report = ingestSidecar(book, await Bun.file(sidecarPath).text());

// --- the finding ---

const pct = (n: number, of: number): string => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);

console.log(`\n  ${report.title}${report.author ? ` · ${report.author}` : ''}`);
console.log(`  ${book.chapters.length} spine items, ${report.total} annotations in the sidecar\n`);
console.log(
  `  progress from KOReader   ${report.progress === null ? '—' : `${(report.progress * 100).toFixed(1)}%`}`,
);
console.log(
  `  highlights resolved      ${report.resolved}/${report.total}  (${pct(report.resolved, report.total)})`,
);
console.log(
  `    via the DocFragment    ${report.viaHint}  (${pct(report.viaHint, report.resolved)} of resolved)`,
);
console.log(`    only by scanning       ${report.viaScan}`);
console.log(`  ambiguous (text repeats) ${report.ambiguous}`);

if (report.misses.length > 0) {
  console.log(`\n  did not cross (${report.misses.length}):`);
  for (const miss of report.misses) {
    const where = miss.chapter ? ` [${miss.chapter}]` : '';
    console.log(
      `    ${miss.why}${where}: "${miss.text.slice(0, 68)}${miss.text.length > 68 ? '…' : ''}"`,
    );
  }
}

// --- the Logseq outline, through the app's own exporter ---

const spineOf = (target: string): number =>
  book.chapters.findIndex((chapter) => chapter.path === target);
const titles = chapterTitles(book.toc, book.chapters.length, spineOf);

const outline = logseqOutline(
  report.title,
  sortHighlights(report.highlights).map((highlight) => ({
    text: highlight.text,
    // KOReader's label first: crengine follows the TOC at a finer grain than
    // the spine, so on a book whose spine lumps many chapters into one file it
    // names the chapter where we can only name the file.
    chapterTitle:
      report.labels.get(highlight.id) ??
      titles[highlight.chapter] ??
      `Chapter ${highlight.chapter + 1}`,
    link: `#/book/ko-demo/hl/${highlight.id}`,
    ...(highlight.note !== undefined ? { note: highlight.note } : {}),
  })),
);

const exportPath = arg('export');
if (exportPath) {
  await Bun.write(exportPath, outline);
  console.log(`\n  wrote ${exportPath}`);
} else {
  console.log('\n  --- Logseq outline ---\n');
  console.log(outline.replace(/^/gm, '  '));
}

// --- optionally, a library the app can open ---

const libraryDir = arg('library');
if (libraryDir) {
  await seedLibrary(libraryDir, report);
  console.log(`  seeded library at ${path.resolve(libraryDir)}`);
}

async function seedLibrary(dir: string, ingested: IngestReport): Promise<void> {
  const bytes = new Uint8Array(await Bun.file(bookPath as string).arrayBuffer());
  const library = await Library.open(new FsTransport(path.resolve(dir)));
  const { sidecar } = await library.importBook(bytes, {
    title: ingested.title,
    author: ingested.author,
  });

  // Everything KOReader knew, written into the file that is the contract.
  // Position stays null on purpose: an xpointer is not a reader-42 locator,
  // so progress crosses and the exact place does not. That gap is the finding,
  // not an omission — see docs/koreader-poc.md.
  await library.saveSidecar({
    ...sidecar,
    state: 'reading',
    progress: ingested.progress ?? 0,
    highlights: sortHighlights(ingested.highlights),
  });
}
