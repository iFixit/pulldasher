ALTER TABLE comments DROP PRIMARY KEY;
ALTER TABLE comments ADD PRIMARY KEY (repo, comment_type, comment_id);
---
ALTER TABLE commit_statuses DROP PRIMARY KEY;
ALTER TABLE commit_statuses ADD PRIMARY KEY (repo, commit);
---
ALTER TABLE issues DROP PRIMARY KEY;
ALTER TABLE issues ADD PRIMARY KEY (repo, number);
---
ALTER TABLE pull_labels DROP PRIMARY KEY;
ALTER TABLE pull_labels ADD PRIMARY KEY (repo, number, title);
---
ALTER TABLE pulls DROP PRIMARY KEY;
ALTER TABLE pulls ADD PRIMARY KEY (repo, number);
