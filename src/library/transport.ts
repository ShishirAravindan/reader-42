// The storage seam.
//
// Files are the contract (see types.ts); a transport is merely somewhere the
// files live. The whole interface is byte-level read/write on paths relative
// to the library root, so a transport knows nothing about books and the app
// knows nothing about where bytes sleep. The drive client, a home server, or
// a local folder all fit behind these two methods.

export interface LibraryTransport {
  /** Read a file's bytes, or null if it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Write a file's bytes, creating parent folders as needed. */
  write(path: string, bytes: Uint8Array): Promise<void>;
}

export async function readJson(transport: LibraryTransport, path: string): Promise<unknown> {
  const bytes = await transport.read(path);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // A truncated or hand-mangled file degrades like a missing one.
    return null;
  }
}

export async function writeJson(
  transport: LibraryTransport,
  path: string,
  value: unknown,
): Promise<void> {
  // Two-space indent: the files are part of the human-readable contract.
  await transport.write(path, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
}
