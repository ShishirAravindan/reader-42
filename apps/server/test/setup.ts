// Shared test bootstrap: point DATA_DIR at a throwaway directory *before*
// any server module loads (data-paths reads the env at import time), and
// make sure the fixture EPUB exists.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-42-test-'));
process.env.DATA_DIR = TEST_DATA_DIR;

const repoRoot = path.resolve(import.meta.dir, '../../../');
export const FIXTURE_EPUB = path.join(repoRoot, 'apps/web/public/fixtures/test-book.epub');

if (!fs.existsSync(FIXTURE_EPUB)) {
  const result = Bun.spawnSync(['bun', 'run', 'apps/web/scripts/build-fixture.ts'], {
    cwd: repoRoot,
  });
  if (result.exitCode !== 0) {
    throw new Error(`could not build fixture EPUB: ${result.stderr.toString()}`);
  }
}

export function fixtureBytes(): Uint8Array<ArrayBuffer> {
  const data = fs.readFileSync(FIXTURE_EPUB);
  const buffer = new ArrayBuffer(data.byteLength);
  const bytes = new Uint8Array(buffer);
  bytes.set(data);
  return bytes;
}
