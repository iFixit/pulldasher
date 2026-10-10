-- A plan's project is a project label's slug, which the rest of Pulldasher
-- takes up to 64 characters (project_issues.project is varchar(64)); 24 kept
-- a longer label from ever getting a plan.
ALTER TABLE `roadmap_items` MODIFY `project` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL;
