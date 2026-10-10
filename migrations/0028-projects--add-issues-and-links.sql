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
  PRIMARY KEY (`project`,`repo`,`number`),
  KEY `issue` (`repo`,`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `issue_pull_links` (
  `issue_repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `issue_number` int unsigned NOT NULL,
  `pull_repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `pull_number` int unsigned NOT NULL,
  `closes` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`issue_repo`,`issue_number`,`pull_repo`,`pull_number`),
  KEY `issue_pull_links_pull` (`pull_repo`,`pull_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
