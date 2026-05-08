import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  sourceType: text('source_type', { enum: ['url', 'pdf', 'url_series'] }).notNull(),
  sourceRef: text('source_ref').notNull(),
  title: text('title'),
  author: text('author'),
  state: text('state', {
    enum: ['captured', 'converting', 'ready', 'reading', 'finished', 'dnf'],
  })
    .notNull()
    .default('captured'),
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),
  quarantined: integer('quarantined', { mode: 'boolean' }).notNull().default(false),
  workspacePath: text('workspace_path'),
  epubPath: text('epub_path'),
  reportPath: text('report_path'),
  capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
