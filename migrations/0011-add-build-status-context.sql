ALTER TABLE `commit_statuses`
ADD COLUMN `context` varchar(255) NOT NULL DEFAULT 'default',
DROP PRIMARY KEY,
ADD PRIMARY KEY (repo, `commit`, context);
