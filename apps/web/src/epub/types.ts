// Core types for the EPUB parser + reader.
// Kept narrow on purpose: v1 only needs what the reader UI consumes.

export interface BookMetadata {
  title: string;
  author: string;
  language: string | null;
  identifier: string | null;
}

export interface Chapter {
  /** Spine index, 0-based. */
  index: number;
  /** Manifest id, e.g. "chap1". */
  id: string;
  /** OPF-relative href, e.g. "OEBPS/chap1.xhtml". */
  href: string;
  /** Resolved absolute path inside the EPUB, normalized. */
  path: string;
  /** Mime type from manifest (typically application/xhtml+xml). */
  mediaType: string;
  /** Human label discovered from the nav/toc, if any. */
  title: string | null;
}

export interface TocEntry {
  label: string;
  /** Absolute path inside the EPUB, normalized (no fragment). */
  path: string;
  /** Optional fragment (e.g. "#sec-2") if the toc target was deeper. */
  fragment: string | null;
  children: TocEntry[];
}

export interface Resource {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface Book {
  /** Deterministic content hash (hex) — stable storage key. */
  id: string;
  metadata: BookMetadata;
  chapters: Chapter[];
  toc: TocEntry[];
  /**
   * Resolve any internal resource (image, css, font, etc.) by its
   * absolute path inside the EPUB. Returns null when missing.
   */
  resolveResource(path: string): Resource | null;
}
