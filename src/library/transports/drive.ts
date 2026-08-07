// Google Drive transport: the synced folder, spoken over the Drive v3 REST
// API with plain fetch. Zero dependencies; auth is injected, never owned.
//
// The library lives in a Drive folder named for the app. Because the scope
// is drive.file, the app sees only files it created — the owner's Drive is
// otherwise invisible to it. Paths from the seam (books/<dir>/book.epub)
// map onto real Drive folders by resolving each component with a files.list
// name query, creating folders on the write path; resolved ids are cached
// in memory and re-resolved once if Drive 404s a stale id.
//
// Error contract (what the device-cache layer above depends on):
//   read  → bytes | null for an authoritative not-found | THROW when the
//           network or Drive itself fails
//   write → resolves | THROW on any failure (the cache layer queues it)
//
// Uploads are two steps (metadata create, then media PATCH) rather than
// multipart — one extra request on first write of a file, in exchange for
// no multipart encoding anywhere. Repeated writes PATCH the same file id,
// so a sidecar never accumulates duplicates.

import type { LibraryTransport } from '../transport.ts';

/** Something that can produce a bearer token for googleapis.com. */
export interface DriveTokenProvider {
  getToken(): Promise<string>;
  /** Drop any cached token; called once after a 401 before the retry. */
  invalidate(): void;
}

export interface DriveTransportConfig {
  tokenProvider: DriveTokenProvider;
  /** Name of the library's root folder in Drive. */
  rootName?: string;
  /** Injectable for tests; defaults to the real network. */
  fetch?: typeof globalThis.fetch;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export class DriveTransport implements LibraryTransport {
  private readonly tokens: DriveTokenProvider;
  private readonly rootName: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  /** folder-or-file path → Drive id. '' is the root folder. */
  private readonly ids = new Map<string, string>();

  constructor(config: DriveTransportConfig) {
    this.tokens = config.tokenProvider;
    this.rootName = config.rootName ?? 'reader-42';
    this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async read(path: string): Promise<Uint8Array | null> {
    const id = await this.resolve(path, { create: false });
    if (!id) return null;
    const res = await this.authFetch(`${API}/files/${id}?alt=media`);
    if (res.status === 404) {
      // The cached id went stale (file replaced elsewhere): re-resolve once.
      this.forget(path);
      const fresh = await this.resolve(path, { create: false });
      if (!fresh) return null;
      const retry = await this.authFetch(`${API}/files/${fresh}?alt=media`);
      if (retry.status === 404) return null;
      if (!retry.ok) throw new Error(`drive: read ${path} failed (${retry.status})`);
      return new Uint8Array(await retry.arrayBuffer());
    }
    if (!res.ok) throw new Error(`drive: read ${path} failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const segments = path.split('/');
    const name = segments.pop();
    if (!name) throw new Error(`drive: cannot write to ${path}`);

    let parent = await this.resolveRoot(true);
    let prefix = '';
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      parent = await this.resolveChild(prefix, parent, segment, {
        create: true,
        folder: true,
      });
      if (!parent) throw new Error(`drive: could not create folder for ${path}`);
    }

    let id = await this.resolveChild(path, parent, name, { create: false, folder: false });
    if (!id) {
      const created = await this.api<DriveFile>('POST', `${API}/files?fields=id,name,mimeType`, {
        name,
        parents: [parent],
      });
      id = created.id;
      this.ids.set(path, id);
    }
    const res = await this.authFetch(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes.slice(),
    });
    if (!res.ok) {
      this.forget(path);
      throw new Error(`drive: write ${path} failed (${res.status})`);
    }
  }

  // --- path resolution ---

  private async resolve(path: string, opts: { create: boolean }): Promise<string | null> {
    const cached = this.ids.get(path);
    if (cached) return cached;
    let parent = await this.resolveRoot(opts.create);
    if (!parent) return null;
    const segments = path.split('/');
    let prefix = '';
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i] as string;
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = i === segments.length - 1;
      const found: string | null = await this.resolveChild(prefix, parent, segment, {
        create: opts.create && !isLeaf,
        folder: !isLeaf,
      });
      if (!found) return null;
      parent = found;
    }
    return parent;
  }

  private async resolveRoot(create: boolean): Promise<string | null> {
    const cached = this.ids.get('');
    if (cached) return cached;
    const q = `name = '${escapeQuery(this.rootName)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = await this.list(q);
    if (found[0]) {
      this.ids.set('', found[0].id);
      return found[0].id;
    }
    if (!create) return null;
    const created = await this.api<DriveFile>('POST', `${API}/files?fields=id,name,mimeType`, {
      name: this.rootName,
      mimeType: FOLDER_MIME,
    });
    this.ids.set('', created.id);
    return created.id;
  }

  private async resolveChild(
    path: string,
    parent: string | null,
    name: string,
    opts: { create: boolean; folder: boolean },
  ): Promise<string | null> {
    const cached = this.ids.get(path);
    if (cached) return cached;
    if (!parent) return null;
    const mime = opts.folder ? ` and mimeType = '${FOLDER_MIME}'` : '';
    const q = `name = '${escapeQuery(name)}' and '${parent}' in parents and trashed = false${mime}`;
    const found = await this.list(q);
    if (found[0]) {
      this.ids.set(path, found[0].id);
      return found[0].id;
    }
    if (!opts.create) return null;
    const created = await this.api<DriveFile>('POST', `${API}/files?fields=id,name,mimeType`, {
      name,
      mimeType: FOLDER_MIME,
      parents: [parent],
    });
    this.ids.set(path, created.id);
    return created.id;
  }

  /** Drop cached ids for a path and everything under it. */
  private forget(path: string): void {
    for (const key of [...this.ids.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.ids.delete(key);
    }
  }

  // --- Drive API plumbing ---

  private async list(q: string): Promise<DriveFile[]> {
    const url = `${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10`;
    const res = await this.authFetch(url);
    if (!res.ok) throw new Error(`drive: list failed (${res.status})`);
    const body = (await res.json()) as { files?: DriveFile[] };
    return body.files ?? [];
  }

  private async api<T>(method: string, url: string, jsonBody: unknown): Promise<T> {
    const res = await this.authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonBody),
    });
    if (!res.ok) throw new Error(`drive: ${method} ${url} failed (${res.status})`);
    return (await res.json()) as T;
  }

  /** Fetch with a bearer token; one refresh-and-retry on 401. */
  private async authFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const token = await this.tokens.getToken();
      return this.fetchImpl(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    };
    const first = await attempt();
    if (first.status !== 401) return first;
    this.tokens.invalidate();
    return attempt();
  }
}

/** Escape a value for a Drive query string literal. */
function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
