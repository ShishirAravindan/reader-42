CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`title` text,
	`author` text,
	`state` text DEFAULT 'captured' NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`quarantined` integer DEFAULT false NOT NULL,
	`workspace_path` text,
	`epub_path` text,
	`report_path` text,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
