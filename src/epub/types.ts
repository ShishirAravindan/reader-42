export interface BookMetadata {
  title: string;
  author: string | null;
  language: string | null;
  identifier: string | null;
}

/** One spine item, in reading order. */
export interface Chapter {
  index: number;
  id: string;
  /** Path inside the archive, normalized. */
  path: string;
  mediaType: string;
}

export interface TocEntry {
  label: string;
  path: string;
  fragment: string | null;
  children: TocEntry[];
}

/**
 * One print-edition page marker from the EPUB page-list nav (parity B2).
 * Label is the print page ("1", "xii"); path/fragment locate its start.
 */
export interface PageTarget {
  label: string;
  path: string;
  fragment: string | null;
}

export interface Resource {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}
