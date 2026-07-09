-- Full-text index over spine text, populated at import time.
-- item_id/chapter/title travel with each row but only `text` is searched.
CREATE VIRTUAL TABLE `items_fts` USING fts5(
	`item_id` UNINDEXED,
	`chapter` UNINDEXED,
	`title` UNINDEXED,
	`text`
);
