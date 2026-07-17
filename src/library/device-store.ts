// The device-local byte store: where the book cache actually sleeps.
//
// Same shape as the transport seam, plus enumeration and deletion so the
// cache can be swept against policy. Keys are library-relative paths (or a
// '~'-prefixed device-meta key, which is never a valid library path). The
// browser implementation lives in browser-store.ts; this in-memory one is
// the reference and the test substrate.

export interface DeviceStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryDeviceStore implements DeviceStore {
  private readonly files = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(key);
    return bytes ? bytes.slice() : null;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.files.set(key, bytes.slice());
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }
}
