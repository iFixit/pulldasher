ALTER TABLE `pulls`
ADD COLUMN `additions` int(11) unsigned DEFAULT NULL,
ADD COLUMN `deletions` int(11) unsigned DEFAULT NULL,
ADD COLUMN `changed_files` int(11) unsigned DEFAULT NULL;
