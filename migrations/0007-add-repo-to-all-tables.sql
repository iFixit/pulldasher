ALTER TABLE `commit_statuses`
ADD COLUMN `repo` VARCHAR(255) NULL BEFORE `commit`;
--
ALTER TABLE `issues`
ADD COLUMN `repo` VARCHAR(255) NULL BEFORE `number`;
--
ALTER TABLE `pull_labels`
ADD COLUMN `repo` VARCHAR(255) NULL BEFORE `number`;
--
ALTER TABLE `pull_signatures`
ADD COLUMN `repo` VARCHAR(255) NULL BEFORE `number`;
--
ALTER TABLE `pulls`
ADD COLUMN `repo` VARCHAR(255) NULL BEFORE `number`;
