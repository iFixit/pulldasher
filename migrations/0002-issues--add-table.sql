CREATE TABLE `issues` (
  `number` int(10) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `difficulty` int(10) DEFAULT NULL,
  `milestone_title` varchar(255) DEFAULT NULL,
  `milestone_due_date` int(11) DEFAULT NULL,
  `assignee` varchar(255) DEFAULT NULL,
  `status` varchar(30) DEFAULT NULL,
  `dateCreated` int(11) DEFAULT NULL,
  `dateClosed` int(11) DEFAULT NULL,
  PRIMARY KEY (`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
