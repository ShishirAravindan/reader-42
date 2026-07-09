import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
