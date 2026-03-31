ALTER TABLE `autofix_state` ADD COLUMN `harness` text;
--> statement-breakpoint

ALTER TABLE `autofix_run` ADD COLUMN `mode` text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE `autofix_run` ADD COLUMN `harness` text;
--> statement-breakpoint

ALTER TABLE `autofix_attempt` ADD COLUMN `review` text;
--> statement-breakpoint
ALTER TABLE `autofix_attempt` ADD COLUMN `gate` text;
