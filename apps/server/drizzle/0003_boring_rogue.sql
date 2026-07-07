CREATE TABLE `highlights` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`chapter` integer NOT NULL,
	`start_path` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_path` text NOT NULL,
	`end_offset` integer NOT NULL,
	`text` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL
);
