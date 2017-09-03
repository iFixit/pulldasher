ALTER TABLE comments MODIFY COLUMN repo_name varchar(255) NULL;
ALTER TABLE pull_labels MODIFY COLUMN repo_name varchar(255);
ALTER TABLE pulls MODIFY COLUMN repo_name varchar(255);

ALTER TABLE pulls DROP KEY pulls_repo;
ALTER TABLE pulls ADD KEY pulls_repo (repo);
