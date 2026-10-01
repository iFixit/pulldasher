ALTER TABLE `scope_items`
  ADD COLUMN `author` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `title`,
  ADD COLUMN `created_at` int unsigned DEFAULT NULL AFTER `author`;

CREATE TABLE IF NOT EXISTS `project_issues` (
  `project` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `number` int unsigned NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `state` enum('open','done','dropped') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `closed_at` int unsigned DEFAULT NULL,
  `author` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` int unsigned DEFAULT NULL,
  `added_by` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `added_at` int unsigned NOT NULL,
  PRIMARY KEY (`project`,`repo`,`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
