// The seam, end to end: a KOReader sidecar plus the EPUB it describes, in,
// reader-42 highlights and an honest account of what crossed, out.
//
// This is the whole claim of the proof of concept. If KOReader is the reading
// surface and reader-42 keeps the shelf and the plumbing to Logseq, then this
// function is the entire contract between them, and its report is the measure
// of whether the arrangement is livable.
//
// Nothing here writes back to KOReader. The seam is deliberately one-way:
// reader-42 reads what the device wrote and never edits a sidecar it does not
// own. Two-way sync is where file formats go to die, and the PoC does not need
// it to answer the question being asked.

import type { Book } from '../epub/book.ts';
import type { Highlight } from '../library/types.ts';
import { findBody, parseChapterDoc, sanitizeContent } from '../reader/render.ts';
import { type ChapterIndex, indexChapter, resolveAnnotation, toHighlight } from './resolve.ts';
import { type KoAnnotation, type KoSidecar, readSidecar } from './sdr.ts';

/** One annotation that did not make it, kept with enough context to judge it. */
export interface Miss {
  text: string;
  chapter?: string;
  why: string;
}

export interface IngestReport {
  title: string;
  author: string | null;
  /** KOReader's own progress, 0..1. */
  progress: number | null;
  status?: string;
  total: number;
  resolved: number;
  /** Resolved in the chapter the xpointer's DocFragment pointed at. */
  viaHint: number;
  /** Resolved only by searching the rest of the book: the hint was wrong. */
  viaScan: number;
  /** Resolved, but the same text occurs more than once in that chapter. */
  ambiguous: number;
  misses: Miss[];
  highlights: Highlight[];
  /**
   * Highlight id → the chapter title KOReader recorded.
   *
   * Worth carrying, and a genuine gain from the crossing: crengine tracks the
   * TOC at a finer grain than a spine item, so for a book whose spine lumps
   * sixty chapters into sixteen files it knows the highlight was in
   * "CHAPTER I." where reader-42 can only name the file. Kept beside the
   * highlights rather than inside them: the sidecar's shape is the owner's,
   * and a spike does not get to widen it.
   */
  labels: Map<string, string>;
}

/**
 * Build the searchable transcript of every chapter, exactly as the reader
 * would mount it: same parse, same body lookup, same sanitizer. Anything that
 * changes structural indices has to happen here too, or the locators this
 * produces address a tree the app never renders.
 */
export function indexBook(book: Book): ChapterIndex[] {
  return book.chapters.map((chapter) => {
    const resource = book.resolveResource(chapter.path);
    if (!resource) return { text: '', points: [], elements: [] };
    const body = findBody(parseChapterDoc(new TextDecoder().decode(resource.bytes)));
    sanitizeContent(body);
    return indexChapter(body);
  });
}

/** FNV-1a over creation time and text, so the same sidecar entry always yields
 * the same highlight id and a re-import merges by union instead of duplicating
 * (decisions.md 2026-08-01). */
function stableId(annotation: KoAnnotation): string {
  const seed = `${annotation.createdAt}|${annotation.text}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ko-${hash.toString(16).padStart(8, '0')}`;
}

export function ingestSidecar(book: Book, sidecarSource: string): IngestReport {
  const sidecar: KoSidecar = readSidecar(sidecarSource);
  const chapters = indexBook(book);

  const highlights: Highlight[] = [];
  const misses: Miss[] = [];
  const labels = new Map<string, string>();
  let viaHint = 0;
  let viaScan = 0;
  let ambiguous = 0;

  for (const annotation of sidecar.annotations) {
    const outcome = resolveAnnotation(annotation, chapters);
    if (!outcome.ok) {
      misses.push({
        text: annotation.text,
        ...(annotation.chapter !== undefined ? { chapter: annotation.chapter } : {}),
        why: outcome.why,
      });
      continue;
    }
    if (outcome.at.via === 'hint') viaHint++;
    else viaScan++;
    if (outcome.at.ambiguous) ambiguous++;
    const id = stableId(annotation);
    if (annotation.chapter !== undefined) labels.set(id, annotation.chapter);
    highlights.push(toHighlight(annotation, outcome.at, id));
  }

  return {
    title: sidecar.title ?? book.metadata.title,
    author: sidecar.author ?? book.metadata.author,
    progress: sidecar.percentFinished,
    ...(sidecar.status !== undefined ? { status: sidecar.status } : {}),
    total: sidecar.annotations.length,
    resolved: highlights.length,
    viaHint,
    viaScan,
    ambiguous,
    misses,
    highlights,
    labels,
  };
}
