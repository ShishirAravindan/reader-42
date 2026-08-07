// DeviceStore for the browser: Cache API for EPUB bytes, IndexedDB for the
// small JSON files (sidecars, index, device meta).
//
// The split is deliberate. EPUBs are megabytes and immutable (the id is a
// content hash), which is exactly what the Cache API is built for; sidecars
// are small, hot, and rewritten constantly, which is IndexedDB territory.
// Both live under storage the platform treats as durable for an installed
// PWA. Callers see one keyspace; the split is an implementation detail.
//
// This module is browser-only by nature and is exercised by the demo
// scripts (the acceptance tests); the cache logic above it is unit-tested
// against MemoryDeviceStore.

import type { DeviceStore } from './device-store.ts';

const BOOK_CACHE = 'books-v1';
const IDB_NAME = 'reader-42';
const IDB_STORE = 'files';

function isEpubKey(key: string): boolean {
  return key.endsWith('.epub');
}

function cacheUrl(key: string): string {
  // A reserved URL namespace; never served, never intercepted by sw.js.
  return `/__book-cache/${encodeURI(key)}`;
}

function keyFromCacheUrl(url: string): string {
  return decodeURI(new URL(url).pathname.slice('/__book-cache/'.length));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class BrowserDeviceStore implements DeviceStore {
  private db: Promise<IDBDatabase> | null = null;

  private idb(): Promise<IDBDatabase> {
    this.db ??= openDb();
    return this.db;
  }

  async get(key: string): Promise<Uint8Array | null> {
    if (isEpubKey(key)) {
      const cache = await caches.open(BOOK_CACHE);
      const hit = await cache.match(cacheUrl(key));
      if (!hit) return null;
      return new Uint8Array(await hit.arrayBuffer());
    }
    const db = await this.idb();
    const store = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE);
    const value = await idbRequest<unknown>(store.get(key));
    return value instanceof Uint8Array ? value.slice() : null;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    if (isEpubKey(key)) {
      const cache = await caches.open(BOOK_CACHE);
      await cache.put(
        cacheUrl(key),
        new Response(bytes.slice(), { headers: { 'Content-Type': 'application/epub+zip' } }),
      );
      return;
    }
    const db = await this.idb();
    const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    await idbRequest(store.put(bytes.slice(), key));
  }

  async delete(key: string): Promise<void> {
    if (isEpubKey(key)) {
      const cache = await caches.open(BOOK_CACHE);
      await cache.delete(cacheUrl(key));
      return;
    }
    const db = await this.idb();
    const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    await idbRequest(store.delete(key));
  }

  async keys(): Promise<string[]> {
    const cache = await caches.open(BOOK_CACHE);
    const cached = (await cache.keys()).map((req) => keyFromCacheUrl(req.url));
    const db = await this.idb();
    const store = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE);
    const idbKeys = (await idbRequest(store.getAllKeys())).filter(
      (k): k is string => typeof k === 'string',
    );
    return [...cached, ...idbKeys].sort();
  }
}
