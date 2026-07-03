CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`author` text,
	`state` text DEFAULT 'unread' NOT NULL,
	`epub_path` text NOT NULL,
	`imported_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
