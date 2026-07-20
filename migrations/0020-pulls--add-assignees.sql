ALTER TABLE `pulls` ADD COLUMN `assignees` json DEFAULT NULL AFTER `owner`;
