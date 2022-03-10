ALTER TABLE commit_statuses
MODIFY COLUMN `log_url` varchar(255) COLLATE utf8mb4_general_ci NULL;
