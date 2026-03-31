CREATE TABLE `autofix_feedback_attachment` (
  `id` text PRIMARY KEY NOT NULL,
  `feedback_id` text NOT NULL REFERENCES `autofix_feedback`(`id`) ON DELETE cascade,
  `external_id` integer,
  `created_at` integer NOT NULL,
  `display_order` integer NOT NULL DEFAULT 0,
  `file_name` text,
  `mime_type` text NOT NULL,
  `file_size_bytes` integer,
  `file_blob` blob NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `autofix_feedback_attachment_feedback_idx`
  ON `autofix_feedback_attachment` (`feedback_id`, `display_order`, `created_at`, `id`);
--> statement-breakpoint
CREATE INDEX `autofix_feedback_attachment_feedback_external_idx`
  ON `autofix_feedback_attachment` (`feedback_id`, `external_id`);
