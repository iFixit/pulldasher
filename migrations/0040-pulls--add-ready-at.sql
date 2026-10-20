-- When a PR last left draft (its update time when Pulldasher saw it go
-- ready), so the Projects windows count it from that day, not the day it
-- opened as a draft. NULL for a PR never seen as a draft, which counts from
-- its open day. Every row stored before this column is NULL too: Pulldasher
-- kept no history of when a PR left draft, so a PR marked ready before this
-- migration still counts from its open day.
ALTER TABLE `pulls` ADD COLUMN `ready_at` int unsigned DEFAULT NULL AFTER `date_pushed`;
