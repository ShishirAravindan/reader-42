import { describe, expect, test } from 'bun:test';
import { type DriveTokenProvider, DriveTransport } from './drive.ts';

// A small in-memory fake of the Drive v3 surface the transport uses:
// files.list by query, metadata create, media upload, media download.
// Enough behavior to prove the path mapping, dedup, auth retry, and error
// contract without a network.

interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: Uint8Array | null;
}

class FakeDrive {
  files = new Map<string, FakeFile>();
  listCalls = 0;
  validToken = 'token-1';
  offline = false;
  private nextId = 1;

  fetch: typeof globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (this.offline) throw new TypeError('network unreachable');
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${this.validToken}`) {
      return new Response('unauthorized', { status: 401 });
    }
    const method = init?.method ?? 'GET';
    const upload = url.pathname.startsWith('/upload/');

    // GET /drive/v3/files?q=... — list by query
    if (method === 'GET' && url.pathname === '/drive/v3/files') {
      this.listCalls++;
      return Response.json({ files: this.query(url.searchParams.get('q') ?? '') });
    }
    // GET /drive/v3/files/{id}?alt=media — download
    if (method === 'GET' && url.pathname.startsWith('/drive/v3/files/')) {
      const file = this.files.get(url.pathname.split('/').pop() ?? '');
      if (!file || file.content === null) return new Response('not found', { status: 404 });
      return new Response(file.content.slice());
    }
    // POST /drive/v3/files — metadata create
    if (method === 'POST' && url.pathname === '/drive/v3/files' && !upload) {
      const meta = JSON.parse(String(init?.body)) as {
        name: string;
        mimeType?: string;
        parents?: string[];
      };
      const id = `f${this.nextId++}`;
      const isFolder = meta.mimeType === 'application/vnd.google-apps.folder';
      this.files.set(id, {
        id,
        name: meta.name,
        mimeType: meta.mimeType ?? 'application/octet-stream',
        parents: meta.parents ?? [],
        content: isFolder ? null : new Uint8Array(),
      });
      return Response.json({ id, name: meta.name, mimeType: meta.mimeType ?? '' });
    }
    // PATCH /upload/drive/v3/files/{id}?uploadType=media — content update
    if (method === 'PATCH' && upload) {
      const file = this.files.get(url.pathname.split('/').pop() ?? '');
      if (!file) return new Response('not found', { status: 404 });
      const body = init?.body as Uint8Array;
      file.content = new Uint8Array(body instanceof Uint8Array ? body : new Uint8Array());
      return Response.json({ id: file.id });
    }
    return new Response(`fake drive: unhandled ${method} ${url.pathname}`, { status: 500 });
  }) as typeof globalThis.fetch;

  private query(q: string): { id: string; name: string; mimeType: string }[] {
    const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1');
    const parent = q.match(/'([^']+)' in parents/)?.[1];
    const folderOnly = q.includes("mimeType = 'application/vnd.google-apps.folder'");
    return [...this.files.values()]
      .filter((f) => f.name === name)
      .filter((f) => (parent ? f.parents.includes(parent) : true))
      .filter((f) => (folderOnly ? f.mimeType === 'application/vnd.google-apps.folder' : true))
      .map(({ id, name: n, mimeType }) => ({ id, name: n, mimeType }));
  }

  /** Test helper: the file whose resolved path matches, walking parents. */
  byPath(path: string): FakeFile | undefined {
    return [...this.files.values()].find((f) => this.pathOf(f) === `reader-42/${path}`);
  }

  private pathOf(file: FakeFile): string {
    const parentId = file.parents[0];
    const parent = parentId ? this.files.get(parentId) : undefined;
    return parent ? `${this.pathOf(parent)}/${file.name}` : file.name;
  }
}

class FakeTokens implements DriveTokenProvider {
  tokens: string[] = ['token-1'];
  getTokenCalls = 0;
  async getToken(): Promise<string> {
    this.getTokenCalls++;
    return this.tokens[0] ?? 'none';
  }
  invalidate(): void {
    this.tokens.shift();
  }
}

function setup(): { drive: FakeDrive; tokens: FakeTokens; transport: DriveTransport } {
  const drive = new FakeDrive();
  const tokens = new FakeTokens();
  const transport = new DriveTransport({ tokenProvider: tokens, fetch: drive.fetch });
  return { drive, tokens, transport };
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

describe('DriveTransport', () => {
  test('reading a file that was never written returns null, not an error', async () => {
    const { transport } = setup();
    expect(await transport.read('library.json')).toBeNull();
    expect(await transport.read('books/alpha-aaa/book.epub')).toBeNull();
  });

  test('write creates the folder hierarchy and read round-trips the bytes', async () => {
    const { drive, transport } = setup();
    await transport.write('books/alpha-aaa/book.epub', enc('epub bytes'));
    expect(dec(await transport.read('books/alpha-aaa/book.epub'))).toBe('epub bytes');
    // Root folder, books/, alpha-aaa/ folders plus one file.
    expect(drive.byPath('books/alpha-aaa/book.epub')).toBeDefined();
    expect([...drive.files.values()].filter((f) => f.content === null)).toHaveLength(3);
  });

  test('repeated writes update in place: no duplicate files, latest bytes win', async () => {
    const { drive, transport } = setup();
    await transport.write('library.json', enc('{"v":1}'));
    await transport.write('library.json', enc('{"v":2}'));
    await transport.write('library.json', enc('{"v":3}'));
    const copies = [...drive.files.values()].filter((f) => f.name === 'library.json');
    expect(copies).toHaveLength(1);
    expect(dec(await transport.read('library.json'))).toBe('{"v":3}');
  });

  test('resolved ids are cached: a re-read issues no new list queries', async () => {
    const { drive, transport } = setup();
    await transport.write('books/alpha-aaa/book.json', enc('{}'));
    await transport.read('books/alpha-aaa/book.json');
    const after = drive.listCalls;
    await transport.read('books/alpha-aaa/book.json');
    await transport.read('books/alpha-aaa/book.json');
    expect(drive.listCalls).toBe(after);
  });

  test('a 401 invalidates the token and retries once, transparently', async () => {
    const { drive, tokens, transport } = setup();
    await transport.write('library.json', enc('{"v":1}'));
    // The token Drive accepts changes; the provider holds old then new.
    drive.validToken = 'token-2';
    tokens.tokens = ['token-1', 'token-2'];
    expect(dec(await transport.read('library.json'))).toBe('{"v":1}');
    expect(tokens.tokens).toEqual(['token-2']); // the stale one was dropped
  });

  test('an unreachable network throws (the cache layer queues on throw)', async () => {
    const { drive, transport } = setup();
    await transport.write('library.json', enc('{"v":1}'));
    drive.offline = true;
    expect(transport.read('library.json')).rejects.toThrow();
    expect(transport.write('library.json', enc('{"v":2}'))).rejects.toThrow();
  });

  test('a stale cached file id re-resolves once instead of failing the read', async () => {
    const { drive, transport } = setup();
    await transport.write('library.json', enc('{"v":1}'));
    // Another device replaces the file: old id vanishes, same name reappears.
    const old = drive.byPath('library.json');
    if (!old) throw new Error('fixture broke');
    drive.files.delete(old.id);
    const replacement: FakeFile = { ...old, id: 'f-new', content: enc('{"v":9}') };
    drive.files.set('f-new', replacement);
    expect(dec(await transport.read('library.json'))).toBe('{"v":9}');
  });

  test('names with quotes are escaped in queries, not injected', async () => {
    const { transport } = setup();
    await transport.write("books/o'brien-abc/book.json", enc('{}'));
    expect(dec(await transport.read("books/o'brien-abc/book.json"))).toBe('{}');
  });
});
