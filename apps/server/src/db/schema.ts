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
  /** Overall reading progress, 0..1 (chapter index + in-chapter fraction). */
  progress: real('progress').notNull().default(0),
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
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
