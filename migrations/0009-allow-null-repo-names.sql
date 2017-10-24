ALTER TABLE `pulls` DROP KEY `pulls_user`; 
ALTER TABLE `pulls` DROP KEY `pulls_repo`;
ALTER TABLE `pulls` ADD KEY `pulls_repo` (`repo`);

ALTER TABLE `comments` DROP COLUMN `repo_name`;
ALTER TABLE `pull_labels` DROP COLUMN `repo_name`;
ALTER TABLE `pulls` DROP COLUMN `repo_name`;
ALTER TABLE `pulls` DROP COLUMN `repo_owner`;
