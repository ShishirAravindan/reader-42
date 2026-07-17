// Development transport: the library folder served by scripts/dev.ts over
// plain HTTP. Exists so the demo/capture scripts (the acceptance tests) can
// drive the app without a native folder picker. Never used in production;
// selected only by an explicit ?lib=dev query.

import type { LibraryTransport } from '../transport.ts';

export class DevHttpTransport implements LibraryTransport {
  async read(path: string): Promise<Uint8Array | null> {
    const res = await fetch(`/lib/${path}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const res = await fetch(`/lib/${path}`, { method: 'PUT', body: bytes.slice() });
    if (!res.ok) throw new Error(`dev transport: write failed for ${path} (${res.status})`);
  }
}
