import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dir, '../../../');

export const DATA_DIR = Bun.env.DATA_DIR ?? path.join(repoRoot, 'data');
export const LIBRARY_DB = path.join(DATA_DIR, 'library.db');
export const EPUBS_DIR = path.join(DATA_DIR, 'epubs');

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, EPUBS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
