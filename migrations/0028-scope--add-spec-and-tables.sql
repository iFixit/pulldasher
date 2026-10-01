ALTER TABLE `roadmap_items`
  ADD COLUMN `spec_repo` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `origin`,
  ADD COLUMN `spec_number` int unsigned DEFAULT NULL AFTER `spec_repo`;

CREATE TABLE IF NOT EXISTS `scope_specs` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `number` int unsigned NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `found` tinyint(1) NOT NULL DEFAULT '1',
  `synced_at` int unsigned NOT NULL,
  PRIMARY KEY (`repo`,`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `scope_items` (
  `spec_repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `spec_number` int unsigned NOT NULL,
  `position` smallint unsigned NOT NULL,
  `source` enum('sub','check') COLLATE utf8mb4_general_ci NOT NULL,
  `repo` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `number` int unsigned DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `state` enum('open','done','dropped') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `closed_at` int unsigned DEFAULT NULL,
  `joined_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`spec_repo`,`spec_number`,`position`)
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
