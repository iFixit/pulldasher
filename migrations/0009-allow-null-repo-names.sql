ALTER TABLE pulls DROP KEY pulls_repo;
ALTER TABLE pulls ADD KEY pulls_repo (repo);
