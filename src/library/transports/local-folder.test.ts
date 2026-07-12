// Exercises path resolution and byte round-trips against a minimal fake of
// the File System Access API surface the transport touches. Real-browser
// behavior is covered by the demo/capture scripts once there is a UI.

import { describe, expect, test } from 'bun:test';
import { LocalFolderTransport } from './local-folder.ts';

class FakeFile {
  bytes: Uint8Array = new Uint8Array();
  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const bytes = this.bytes;
    return {
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  }
  async createWritable(): Promise<{
    write(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }> {
    return {
      write: async (data: Uint8Array) => {
        this.bytes = data.slice();
      },
      close: async () => {},
    };
  }
}

class FakeDir {
  readonly dirs = new Map<string, FakeDir>();
  readonly files = new Map<string, FakeFile>();

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      dir = new FakeDir();
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    let file = this.files.get(name);
    if (!file) {
      if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
      file = new FakeFile();
      this.files.set(name, file);
    }
    return file;
  }
}

const transportOver = (root: FakeDir) =>
  new LocalFolderTransport(root as unknown as FileSystemDirectoryHandle);

describe('LocalFolderTransport', () => {
  test('write creates nested folders, read round-trips bytes', async () => {
    const root = new FakeDir();
    const t = transportOver(root);
    const bytes = new TextEncoder().encode('epub bytes');
    await t.write('books/a-book-abc123/book.epub', bytes);
    expect(await t.read('books/a-book-abc123/book.epub')).toEqual(bytes);
    expect(root.dirs.get('books')?.dirs.has('a-book-abc123')).toBe(true);
  });

  test('missing files and folders read as null', async () => {
    const t = transportOver(new FakeDir());
    expect(await t.read('library.json')).toBeNull();
    expect(await t.read('books/ghost/book.epub')).toBeNull();
  });

  test('bad path throws instead of writing nowhere', async () => {
    const t = transportOver(new FakeDir());
    expect(t.write('/', new Uint8Array())).rejects.toThrow('bad path');
  });
});
