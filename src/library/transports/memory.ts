// In-memory transport: the reference implementation of the seam and the
// substrate for tests. Behaviorally identical to a folder that forgets.

import type { LibraryTransport } from '../transport.ts';

export class MemoryTransport implements LibraryTransport {
  private readonly files = new Map<string, Uint8Array>();

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path);
    return bytes ? bytes.slice() : null;
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes.slice());
  }

  /** Test helper: every stored path, sorted. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}
