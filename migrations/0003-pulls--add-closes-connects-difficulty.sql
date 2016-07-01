ALTER TABLE `pulls`
ADD COLUMN `closes` int(10) unsigned DEFAULT NULL AFTER `milestone_due_on`,
ADD COLUMN `connects` int(10) unsigned DEFAULT NULL AFTER `closes`,
ADD COLUMN `difficulty` int(11) DEFAULT NULL AFTER `connects`;
