ALTER TABLE `project_issues`
  ADD COLUMN `linked_by` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  ADD COLUMN `removed_at` int unsigned DEFAULT NULL;
