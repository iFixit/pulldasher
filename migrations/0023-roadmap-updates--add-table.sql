CREATE TABLE IF NOT EXISTS `roadmap_updates` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `item_id` int unsigned NOT NULL,
  `health` enum('on_track','at_risk','off_track') COLLATE utf8mb4_general_ci NOT NULL,
  `body` text COLLATE utf8mb4_general_ci NOT NULL,
  `plan_start` date NOT NULL,
  `plan_weeks` smallint unsigned NOT NULL,
  `created_by` varchar(39) COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  KEY `roadmap_updates_item` (`item_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
