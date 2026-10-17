CREATE TABLE `processed_imports` (
	`id` integer PRIMARY KEY,
	`content_hash` text NOT NULL,
	`original_name` text NOT NULL,
	`target_path` text NOT NULL,
	`document_date` text,
	`sender` text,
	`category` text,
	`title` text,
	`model` text,
	`filed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `unprocessed_imports` (
	`id` integer PRIMARY KEY,
	`inbox_path` text NOT NULL UNIQUE,
	`file_name` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`duplicate_of_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_unprocessed_imports_duplicate_of_id_processed_imports_id_fk` FOREIGN KEY (`duplicate_of_id`) REFERENCES `processed_imports`(`id`) ON DELETE SET NULL,
	CONSTRAINT "unprocessed_imports_status" CHECK("status" IN ('pending', 'failed', 'duplicate'))
);
--> statement-breakpoint
CREATE INDEX `idx_processed_imports_content_hash` ON `processed_imports` (`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_unprocessed_imports_content_hash` ON `unprocessed_imports` (`content_hash`);