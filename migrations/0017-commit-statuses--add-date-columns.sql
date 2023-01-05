ALTER TABLE commit_statuses
ADD COLUMN `started_at` int unsigned DEFAULT NULL AFTER `context`,
ADD COLUMN `completed_at` int unsigned DEFAULT NULL AFTER `started_at`;
