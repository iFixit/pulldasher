-- MySQL dump 10.13  Distrib 5.6.35-81.0, for Linux (x86_64)
-- ------------------------------------------------------
-- Server version	5.6.35-81.0-log

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!50112 SELECT COUNT(*) INTO @is_rocksdb_supported FROM INFORMATION_SCHEMA.SESSION_VARIABLES WHERE VARIABLE_NAME='rocksdb_bulk_load' */;
/*!50112 SET @save_old_rocksdb_bulk_load = IF (@is_rocksdb_supported, 'SET @old_rocksdb_bulk_load = @@rocksdb_bulk_load', 'SET @dummy_old_rocksdb_bulk_load = 0') */;
/*!50112 PREPARE s FROM @save_old_rocksdb_bulk_load */;
/*!50112 EXECUTE s */;
/*!50112 SET @enable_bulk_load = IF (@is_rocksdb_supported, 'SET SESSION rocksdb_bulk_load = 1', 'SET @dummy_rocksdb_bulk_load = 0') */;
/*!50112 PREPARE s FROM @enable_bulk_load */;
/*!50112 EXECUTE s */;
/*!50112 DEALLOCATE PREPARE s */;

--
-- Table structure for table `comments`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `comments` (
  `repo` varchar(255) DEFAULT NULL,
  `comment_type` enum('issue','review') NOT NULL DEFAULT 'issue',
  `comment_id` int(10) unsigned NOT NULL,
  `number` int(10) unsigned NOT NULL,
  `repo_name` varchar(255) NOT NULL,
  `user` varchar(255) NOT NULL,
  `date` int(11) unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`),
  KEY `pull` (`repo_name`,`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `commit_statuses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `commit_statuses` (
  `repo` varchar(255) NOT NULL,
  `commit` char(40) NOT NULL,
  `state` enum('pending','success','error','failure') NOT NULL,
  `description` varchar(255) NOT NULL,
  `log_url` varchar(255) NOT NULL,
  PRIMARY KEY (`repo`,`commit`),
  KEY `commit_statuses_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `issues`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `issues` (
  `repo` varchar(255) DEFAULT NULL,
  `number` int(10) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `difficulty` int(10) DEFAULT NULL,
  `milestone_title` varchar(255) DEFAULT NULL,
  `milestone_due_on` int(11) DEFAULT NULL,
  `assignee` varchar(255) DEFAULT NULL,
  `status` varchar(30) DEFAULT NULL,
  `date_closed` int(11) DEFAULT NULL,
  `date_created` int(11) DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pull_labels`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pull_labels` (
  `repo` varchar(255) DEFAULT NULL,
  `number` int(10) unsigned NOT NULL,
  `title` varchar(32) NOT NULL,
  `repo_name` varchar(255) NOT NULL,
  `user` varchar(255) DEFAULT NULL,
  `date` int(11) unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`),
  KEY `pull_labels_title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pull_signatures`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pull_signatures` (
  `repo` varchar(255) DEFAULT NULL,
  `number` int(10) unsigned NOT NULL,
  `user` varchar(255) NOT NULL,
  `type` varchar(32) NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `comment_id` int(10) unsigned NOT NULL,
  `userid` int(10) unsigned NOT NULL,
  `date` int(11) unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`),
  KEY `pull_signatures_number` (`number`,`active`),
  KEY `pull_signatures_user_type` (`user`,`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pulls`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `pulls` (
  `repo` varchar(255) DEFAULT NULL,
  `number` int(10) unsigned NOT NULL,
  `state` enum('open','closed') NOT NULL,
  `title` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `head_branch` varchar(255) NOT NULL,
  `head_sha` char(40) NOT NULL,
  `repo_owner` varchar(255) NOT NULL,
  `repo_name` varchar(255) NOT NULL,
  `base_branch` varchar(255) NOT NULL,
  `owner` varchar(255) NOT NULL,
  `cr_req` int(11) NOT NULL DEFAULT '2',
  `qa_req` int(11) NOT NULL DEFAULT '1',
  `date` int(11) unsigned DEFAULT NULL,
  `date_updated` int(11) unsigned DEFAULT NULL,
  `date_closed` int(11) unsigned DEFAULT NULL,
  `date_merged` int(11) unsigned DEFAULT NULL,
  `milestone_title` varchar(255) DEFAULT NULL,
  `milestone_due_on` int(11) unsigned DEFAULT NULL,
  `closes` int(10) unsigned DEFAULT NULL,
  `connects` int(10) unsigned DEFAULT NULL,
  `difficulty` int(11) DEFAULT NULL,
  PRIMARY KEY (`number`),
  KEY `pulls_state` (`state`),
  KEY `pulls_repo` (`repo_owner`,`repo_name`),
  KEY `pulls_user` (`owner`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!50112 SET @disable_bulk_load = IF (@is_rocksdb_supported, 'SET SESSION rocksdb_bulk_load = @old_rocksdb_bulk_load', 'SET @dummy_rocksdb_bulk_load = 0') */;
/*!50112 PREPARE s FROM @disable_bulk_load */;
/*!50112 EXECUTE s */;
/*!50112 DEALLOCATE PREPARE s */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed
