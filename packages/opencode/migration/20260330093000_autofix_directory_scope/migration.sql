CREATE TEMP TABLE `autofix_scope_dir` AS
WITH ranked AS (
  SELECT
    r.project_id AS project_id,
    s.directory AS directory,
    COUNT(*) AS total,
    MAX(r.time_created) AS last_time,
    ROW_NUMBER() OVER (
      PARTITION BY r.project_id
      ORDER BY COUNT(*) DESC, MAX(r.time_created) DESC, s.directory ASC
    ) AS rn
  FROM `autofix_run` r
  LEFT JOIN `session` s ON s.id = r.session_id
  WHERE s.directory IS NOT NULL AND s.directory != ''
  GROUP BY r.project_id, s.directory
)
SELECT
  p.id AS project_id,
  COALESCE(
    (
      SELECT ranked.directory
      FROM ranked
      WHERE ranked.project_id = p.id AND ranked.rn = 1
    ),
    NULLIF(p.worktree, ''),
    '/'
  ) AS directory
FROM `project` p;
--> statement-breakpoint

DROP INDEX IF EXISTS `autofix_state_status_idx`;
--> statement-breakpoint

ALTER TABLE `autofix_feedback` ADD COLUMN `directory` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `autofix_feedback`
SET `directory` = COALESCE(
  (
    SELECT `directory`
    FROM `autofix_scope_dir`
    WHERE `project_id` = `autofix_feedback`.`project_id`
  ),
  ''
);
--> statement-breakpoint
DROP INDEX IF EXISTS `autofix_feedback_project_external_idx`;
--> statement-breakpoint
DROP INDEX IF EXISTS `autofix_feedback_project_status_created_idx`;
--> statement-breakpoint
CREATE INDEX `autofix_feedback_project_external_idx` ON `autofix_feedback` (`project_id`, `directory`, `external_id`);
--> statement-breakpoint
CREATE INDEX `autofix_feedback_project_status_created_idx` ON `autofix_feedback` (`project_id`, `directory`, `status`, `created_at`, `id`);
--> statement-breakpoint

ALTER TABLE `autofix_run` ADD COLUMN `directory` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `autofix_run`
SET `directory` = COALESCE(
  (
    SELECT `directory`
    FROM `autofix_feedback`
    WHERE `id` = `autofix_run`.`feedback_id`
  ),
  (
    SELECT `directory`
    FROM `autofix_scope_dir`
    WHERE `project_id` = `autofix_run`.`project_id`
  ),
  ''
);
--> statement-breakpoint
DROP INDEX IF EXISTS `autofix_run_project_created_idx`;
--> statement-breakpoint
CREATE INDEX `autofix_run_project_created_idx` ON `autofix_run` (`project_id`, `directory`, `time_created`);
--> statement-breakpoint

ALTER TABLE `autofix_event` ADD COLUMN `directory` text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE `autofix_event`
SET `directory` = COALESCE(
  (
    SELECT `directory`
    FROM `autofix_run`
    WHERE `id` = `autofix_event`.`run_id`
  ),
  (
    SELECT `directory`
    FROM `autofix_feedback`
    WHERE `id` = `autofix_event`.`feedback_id`
  ),
  (
    SELECT `directory`
    FROM `autofix_scope_dir`
    WHERE `project_id` = `autofix_event`.`project_id`
  ),
  ''
);
--> statement-breakpoint
DROP INDEX IF EXISTS `autofix_event_project_time_idx`;
--> statement-breakpoint
CREATE INDEX `autofix_event_project_time_idx` ON `autofix_event` (`project_id`, `directory`, `time_created`);
--> statement-breakpoint

ALTER TABLE `autofix_state` RENAME TO `autofix_state_old`;
--> statement-breakpoint
CREATE TABLE `autofix_state` (
  `project_id` text NOT NULL REFERENCES `project`(`id`) ON DELETE cascade,
  `directory` text NOT NULL,
  `profile` text,
  `status` text NOT NULL,
  `note` text,
  `source_cursor_created_at` integer,
  `source_cursor_external_id` integer,
  `time_last_sync` integer,
  `active_run_id` text,
  `last_success_commit` text,
  `last_success_version` text,
  `prompt` text,
  `stop_requested` integer NOT NULL DEFAULT false,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  PRIMARY KEY (`project_id`, `directory`)
);
--> statement-breakpoint
INSERT INTO `autofix_state` (
  `project_id`,
  `directory`,
  `profile`,
  `status`,
  `note`,
  `source_cursor_created_at`,
  `source_cursor_external_id`,
  `time_last_sync`,
  `active_run_id`,
  `last_success_commit`,
  `last_success_version`,
  `prompt`,
  `stop_requested`,
  `time_created`,
  `time_updated`
)
SELECT
  s.`project_id`,
  COALESCE(
    (
      SELECT `directory`
      FROM `autofix_scope_dir`
      WHERE `project_id` = s.`project_id`
    ),
    ''
  ),
  s.`profile`,
  s.`status`,
  s.`note`,
  s.`source_cursor_created_at`,
  s.`source_cursor_external_id`,
  s.`time_last_sync`,
  s.`active_run_id`,
  s.`last_success_commit`,
  s.`last_success_version`,
  s.`prompt`,
  s.`stop_requested`,
  s.`time_created`,
  s.`time_updated`
FROM `autofix_state_old` s;
--> statement-breakpoint
DROP TABLE `autofix_state_old`;
--> statement-breakpoint
CREATE INDEX `autofix_state_status_idx` ON `autofix_state` (`status`);
--> statement-breakpoint

DROP TABLE `autofix_scope_dir`;
