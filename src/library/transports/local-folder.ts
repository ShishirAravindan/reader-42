// Local-folder transport: the library folder opened directly in the browser
// via the File System Access API (window.showDirectoryPicker). This is the
// zero-setup transport: point it at the folder your drive client already
// syncs to disk and the whole architecture works with no account anywhere.
//
// Chromium-only for now; the drive transport covers everything else.

import type { LibraryTransport } from '../transport.ts';

export class LocalFolderTransport implements LibraryTransport {
  private readonly root: FileSystemDirectoryHandle;

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      const { dir, name } = await this.resolve(path, false);
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      // NotFoundError and friends all mean the same thing to callers.
      return null;
    }
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const { dir, name } = await this.resolve(path, true);
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    // slice() re-backs the view with a plain ArrayBuffer, which the write API requires.
    await writable.write(bytes.slice());
    await writable.close();
  }

  private async resolve(
    path: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const segments = path.split('/').filter((s) => s.length > 0);
    const name = segments.pop();
    if (!name) throw new Error(`library: bad path "${path}"`);
    let dir = this.root;
    for (const segment of segments) {
      dir = await dir.getDirectoryHandle(segment, { create });
    }
    return { dir, name };
  }
}
