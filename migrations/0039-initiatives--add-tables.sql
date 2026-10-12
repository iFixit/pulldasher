CREATE TABLE IF NOT EXISTS `initiatives` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `slug` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_general_ci NOT NULL,
  `kind` enum('initiative','upkeep','untracked') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'initiative',
  `goal` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `owner_login` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `priority` int NOT NULL DEFAULT '0',
  `status` enum('open','done','dropped') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `status_at` int unsigned DEFAULT NULL,
  `created_by` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` int unsigned DEFAULT NULL,
  `updated_by` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `updated_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `initiatives_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `initiative_projects` (
  `project` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `initiative_id` int unsigned NOT NULL,
  `set_by` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `set_at` int unsigned NOT NULL,
  `baseline_prs` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`project`),
  KEY `initiative_projects_initiative` (`initiative_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
