ALTER TABLE `roadmap_items` ADD COLUMN `origin` enum('asked','fire','chosen') COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `status`;
