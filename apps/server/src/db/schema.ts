import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  title: text('title'),
  author: text('author'),
  state: text('state', {
    enum: ['unread', 'reading', 'finished', 'dnf'],
  })
    .notNull()
    .default('unread'),
  epubPath: text('epub_path').notNull(),
  /** sha256 of the EPUB bytes — re-importing the same file is a no-op. */
  contentHash: text('content_hash'),
  /** Overall reading progress, 0..1 (chapter index + in-chapter fraction). */
  progress: real('progress').notNull().default(0),
  /** JSON reading position {chapter, scroll, anchor?} — syncs across devices. */
  position: text('position'),
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const highlights = sqliteTable('highlights', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull(),
  chapter: integer('chapter').notNull(),
  /** JSON-encoded element-index paths + char offsets (see web renderer). */
  startPath: text('start_path').notNull(),
  startOffset: integer('start_offset').notNull(),
  endPath: text('end_path').notNull(),
  endOffset: integer('end_offset').notNull(),
  text: text('text').notNull(),
  note: text('note'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const readingSessions = sqliteTable('reading_sessions', {
  id: text('id').primaryKey(),
  itemId: text('item_id').notNull(),
  seconds: integer('seconds').notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ReadingSession = typeof readingSessions.$inferSelect;
