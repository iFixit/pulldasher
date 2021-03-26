--
-- Table structure for table `pull_labels_history`
--
CREATE TABLE IF NOT EXISTS `pull_labels_history` (
  `repo` varchar(255) NOT NULL,
  `number` int(10) unsigned NOT NULL,
  `title` varchar(32) NOT NULL,
  `date_added` int(11) unsigned DEFAULT NULL,
  `date_removed` int(11) unsigned DEFAULT NULL,
  `user` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`,`title`,`date_added`),
  KEY `pull_labels_history_title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
