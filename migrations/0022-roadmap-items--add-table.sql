CREATE TABLE IF NOT EXISTS `roadmap_items` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `project` varchar(24) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `team` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `lead_login` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('planned','active','done','dropped') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'planned',
  `start` date NOT NULL,
  `weeks` smallint unsigned NOT NULL DEFAULT '4',
  `priority` int NOT NULL DEFAULT '0',
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` int unsigned DEFAULT NULL,
  `updated_by` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `updated_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `roadmap_items_priority` (`priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
