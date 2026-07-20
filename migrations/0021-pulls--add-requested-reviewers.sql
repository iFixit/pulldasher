ALTER TABLE `pulls` ADD COLUMN `requested_reviewers` json DEFAULT NULL AFTER `assignees`;
