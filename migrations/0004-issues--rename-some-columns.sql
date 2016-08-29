ALTER TABLE `issues`
CHANGE COLUMN `dateCreated`        `date_closed`      int(11) DEFAULT NULL,
CHANGE COLUMN `dateClosed`         `date_created`     int(11) DEFAULT NULL;
