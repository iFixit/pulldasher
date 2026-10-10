CREATE TABLE IF NOT EXISTS `project_settings` (
  `name` varchar(64) COLLATE utf8mb4_general_ci NOT NULL,
  `value` text COLLATE utf8mb4_general_ci NOT NULL,
  `updated_by` varchar(39) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `updated_at` int unsigned DEFAULT NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
