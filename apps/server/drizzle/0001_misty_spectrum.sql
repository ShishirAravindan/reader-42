CREATE TABLE `reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`seconds` integer NOT NULL,
	`ended_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `items` ADD `progress` real DEFAULT 0 NOT NULL;