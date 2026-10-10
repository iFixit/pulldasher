ALTER TABLE `roadmap_items` ADD COLUMN `status_at` int unsigned DEFAULT NULL AFTER `updated_at`;
UPDATE `roadmap_items` SET `status_at` = `updated_at` WHERE `status` IN ('parked','done','dropped');
