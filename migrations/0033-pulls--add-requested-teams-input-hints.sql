ALTER TABLE `pulls`
  ADD COLUMN `requested_teams` json DEFAULT NULL AFTER `requested_reviewers`,
  ADD COLUMN `input_hints` json DEFAULT NULL AFTER `requested_teams`;
