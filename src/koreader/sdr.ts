// KOReader's sidecar schema, mapped onto reader-42's vocabulary.
//
// Shape and field names come from KOReader's own
// `frontend/apps/reader/modules/readerannotation.lua`, which builds every
// annotation it persists. For an EPUB (crengine's "rolling" mode) the
// positions are xpointer strings; for PDFs they are tables, and those are not
// this project's business (non-goals: EPUB is the substrate), so they are
// skipped rather than half-supported.
//
// The load-bearing fact about an xpointer:
//
//     /body/DocFragment[3]/body/div/p[2]/text().59
//      \_______________/ \_______________________/
//        portable            NOT portable
//
// The DocFragment index is the spine item — the same spine reader-42 counts,
// so it survives the crossing. Everything after it is a path through
// crengine's OWN normalized DOM (versioned by the sidecar's
// `cre_dom_version`), which is not the tree a browser builds from the same
// XHTML. So the tail is taken as a hint and never as truth, and the text is
// what actually locates a highlight on this side. That asymmetry is the whole
// finding; see docs/koreader-poc.md.

import { array, isTable, num, parseSidecar, str, table } from './lua.ts';

/**
 * The four highlight tints.
 *
 * These were the reader's palette; with the reader retired they belong here,
 * because the only thing that still needs them is the shelf drawing a dot
 * beside a highlight some device made.
 */
export const HIGHLIGHT_COLORS = ['yellow', 'pink', 'blue', 'orange'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** One KOReader annotation, reduced to the fields that can cross. */
export interface KoAnnotation {
  /** The highlighted text. The only field that reliably locates it here. */
  text: string;
  note?: string;
  /** KOReader's own chapter title. Kept: salvage §5 says never show spine indices. */
  chapter?: string;
  color: HighlightColor;
  /** Creation time, as KOReader wrote it. */
  createdAt: string;
  /** Spine index from the xpointer's DocFragment, or null when unreadable. */
  spineHint: number | null;
  /** The raw xpointer, carried for the record rather than resolved. */
  xpointer: string | null;
}

export interface KoSidecar {
  title?: string;
  author?: string;
  /** 0..1, KOReader's own reading progress. */
  percentFinished: number | null;
  /** KOReader's reading status, when it has one. */
  status?: string;
  annotations: KoAnnotation[];
}

/**
 * KOReader's nine highlight colors onto reader-42's four (parity F1).
 *
 * Lossy on purpose. The alternative is widening our palette to match another
 * app's, which inverts who owns the design. Warm stays warm, cool stays cool,
 * and anything with no counterpart lands on yellow — the palette's default,
 * and what an uncolored KOReader highlight means anyway.
 */
export function mapColor(koColor: string | undefined): HighlightColor {
  switch (koColor) {
    case 'orange':
      return 'orange';
    case 'blue':
    case 'cyan':
      return 'blue';
    case 'red':
    case 'purple':
      return 'pink';
    default:
      return 'yellow';
  }
}

/**
 * The spine index an xpointer names. DocFragment is 1-based over the spine
 * items crengine rendered; reader-42's chapters are 0-based over the spine it
 * parsed. Those agree for ordinary books and can drift when crengine skips an
 * item, which is exactly why the caller treats this as a hint and falls back
 * to searching the whole book.
 */
export function spineIndexFromXPointer(xpointer: string | undefined): number | null {
  if (!xpointer) return null;
  const match = /DocFragment\[(\d+)\]/.exec(xpointer);
  if (!match) return null;
  const oneBased = Number(match[1]);
  return Number.isInteger(oneBased) && oneBased >= 1 ? oneBased - 1 : null;
}

/**
 * KOReader's `"2026-09-12 21:04:11"` is device-local wall time with no zone.
 * It becomes `"2026-09-12T21:04:11"` — still ISO 8601, still zone-less.
 * Stamping a zone on it would be inventing information we were not given.
 */
export function toIsoish(datetime: string | undefined): string {
  if (!datetime) return new Date().toISOString();
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(datetime);
  return match ? `${match[1]}T${match[2]}` : datetime;
}

/** Parse a `metadata.<ext>.lua` into the fields that can cross the seam. */
export function readSidecar(source: string): KoSidecar {
  const root = parseSidecar(source);
  if (!isTable(root)) throw new Error('sidecar is not a table');

  const props = table(root, 'doc_props');
  const summary = table(root, 'summary');
  const percent = num(root, 'percent_finished');

  const annotations: KoAnnotation[] = [];
  const list = table(root, 'annotations');
  if (list) {
    for (const entry of array(list)) {
      if (!isTable(entry)) continue;
      const text = str(entry, 'text');
      // No text is a page bookmark, not a highlight; and a table-valued pos0
      // is a PDF annotation. Neither can cross, and neither is an error.
      if (!text) continue;
      const pos0 = str(entry, 'pos0') ?? str(entry, 'page');
      annotations.push({
        text,
        ...(str(entry, 'note') !== undefined ? { note: str(entry, 'note') as string } : {}),
        ...(str(entry, 'chapter') !== undefined
          ? { chapter: str(entry, 'chapter') as string }
          : {}),
        color: mapColor(str(entry, 'color')),
        createdAt: toIsoish(str(entry, 'datetime')),
        spineHint: spineIndexFromXPointer(pos0),
        xpointer: pos0 ?? null,
      });
    }
  }

  return {
    ...(props && str(props, 'title') !== undefined ? { title: str(props, 'title') as string } : {}),
    ...(props && str(props, 'authors') !== undefined
      ? { author: str(props, 'authors') as string }
      : {}),
    percentFinished: percent !== undefined && percent >= 0 && percent <= 1 ? percent : null,
    ...(summary && str(summary, 'status') !== undefined
      ? { status: str(summary, 'status') as string }
      : {}),
    annotations,
  };
}
