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

export interface Resource {
  path: string;
  mediaType: string;
  bytes: Uint8Array;
}
