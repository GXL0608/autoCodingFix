CREATE TABLE `autofix_state` (
  `project_id` text PRIMARY KEY NOT NULL REFERENCES `project`(`id`) ON DELETE cascade,
  `profile` text,
  `status` text NOT NULL,
  `note` text,
  `source_cursor_created_at` integer,
  `source_cursor_external_id` integer,
  `time_last_sync` integer,
  `active_run_id` text,
  `last_success_commit` text,
  `last_success_version` text,
  `stop_requested` integer NOT NULL DEFAULT false,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint

CREATE INDEX `autofix_state_status_idx` ON `autofix_state` (`status`);--> statement-breakpoint

CREATE TABLE `autofix_feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE cascade,
  `external_id` integer NOT NULL,
  `created_at` integer NOT NULL,
  `request_id` text,
  `source` text NOT NULL,
  `feedback_token` text NOT NULL,
  `device_id` text NOT NULL,
  `uploader` text,
  `app_version` text,
  `audio_filename` text,
  `audio_mime_type` text,
  `audio_size_bytes` integer,
  `audio_duration_ms` integer,
  `has_audio` integer NOT NULL DEFAULT false,
  `language` text,
  `recognized_text` text,
  `processing_time_ms` real,
  `recognize_success` integer NOT NULL DEFAULT false,
  `recognize_http_status` integer,
  `recognize_error` text,
  `recognize_response` text,
  `meta` text,
  `status` text NOT NULL,
  `note` text,
  `last_run_id` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint

CREATE INDEX `autofix_feedback_project_external_idx` ON `autofix_feedback` (`project_id`, `external_id`);--> statement-breakpoint
CREATE INDEX `autofix_feedback_project_status_created_idx` ON `autofix_feedback` (`project_id`, `status`, `created_at`, `id`);--> statement-breakpoint

CREATE TABLE `autofix_run` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE cascade,
  `feedback_id` text NOT NULL REFERENCES `autofix_feedback`(`id`) ON DELETE cascade,
  `session_id` text,
  `branch` text,
  `base_commit` text,
  `last_success_commit` text,
  `commit_hash` text,
  `version` text,
  `status` text NOT NULL,
  `failure_reason` text,
  `plan` text,
  `summary` text,
  `report_json_path` text,
  `report_md_path` text,
  `smoke_log_path` text,
  `package_log_path` text,
  `time_finished` integer,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint

CREATE INDEX `autofix_run_project_created_idx` ON `autofix_run` (`project_id`, `time_created`);--> statement-breakpoint
CREATE INDEX `autofix_run_feedback_idx` ON `autofix_run` (`feedback_id`, `time_created`);--> statement-breakpoint

CREATE TABLE `autofix_attempt` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL REFERENCES `autofix_run`(`id`) ON DELETE cascade,
  `attempt` integer NOT NULL,
  `status` text NOT NULL,
  `summary` text,
  `error` text,
  `verify_ok` integer,
  `verify_log_path` text,
  `package_log_path` text,
  `files` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint

CREATE INDEX `autofix_attempt_run_attempt_idx` ON `autofix_attempt` (`run_id`, `attempt`);--> statement-breakpoint

CREATE TABLE `autofix_artifact` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL REFERENCES `autofix_run`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `path` text NOT NULL,
  `sha256` text,
  `size_bytes` integer,
  `mime` text,
  `meta` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);--> statement-breakpoint

CREATE INDEX `autofix_artifact_run_kind_idx` ON `autofix_artifact` (`run_id`, `kind`);--> statement-breakpoint

CREATE TABLE `autofix_event` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE cascade,
  `run_id` text REFERENCES `autofix_run`(`id`) ON DELETE cascade,
  `feedback_id` text REFERENCES `autofix_feedback`(`id`) ON DELETE cascade,
  `phase` text NOT NULL,
  `level` text NOT NULL,
  `message` text NOT NULL,
  `payload_json` text,
  `time_created` integer NOT NULL
);--> statement-breakpoint

CREATE INDEX `autofix_event_project_time_idx` ON `autofix_event` (`project_id`, `time_created`);--> statement-breakpoint
CREATE INDEX `autofix_event_run_time_idx` ON `autofix_event` (`run_id`, `time_created`);
