ALTER TABLE `issues` ADD COLUMN `field_start` char(10) COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `milestone_due_on`,
  ADD COLUMN `field_target` char(10) COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `field_start`,
  ADD COLUMN `field_priority` varchar(16) COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `field_target`;
