import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { LIBRARY_DB, ensureDataDirs } from '../data-paths.ts';
import * as schema from './schema.ts';

ensureDataDirs();

const sqlite = new Database(LIBRARY_DB, { create: true });
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export { schema };
