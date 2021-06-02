CREATE TABLE `reviews` (
  `repo` varchar(255) NOT NULL,
  `review_id` int(10) unsigned NOT NULL,
  `number` int(10) unsigned NOT NULL,
  `body` text NOT NULL,
  `state` varchar(255) NOT NULL,
  `user` varchar(255) NOT NULL,
  `date` int(11) unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`review_id`),
  KEY `pull` (`number`)
);
