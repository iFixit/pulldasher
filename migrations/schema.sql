-- MySQL dump 10.13  Distrib 8.0.27-18, for Linux (x86_64)
--
-- Host: db.cominor.com    Database: metrics
-- ------------------------------------------------------
-- Server version	8.0.27-18

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
/*!50717 SELECT COUNT(*) INTO @rocksdb_has_p_s_session_variables FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'performance_schema' AND TABLE_NAME = 'session_variables' */;
/*!50717 SET @rocksdb_get_is_supported = IF (@rocksdb_has_p_s_session_variables, 'SELECT COUNT(*) INTO @rocksdb_is_supported FROM performance_schema.session_variables WHERE VARIABLE_NAME=\'rocksdb_bulk_load\'', 'SELECT 0') */;
/*!50717 PREPARE s FROM @rocksdb_get_is_supported */;
/*!50717 EXECUTE s */;
/*!50717 DEALLOCATE PREPARE s */;
/*!50717 SET @rocksdb_enable_bulk_load = IF (@rocksdb_is_supported, 'SET SESSION rocksdb_bulk_load = 1', 'SET @rocksdb_dummy_bulk_load = 0') */;
/*!50717 PREPARE s FROM @rocksdb_enable_bulk_load */;
/*!50717 EXECUTE s */;
/*!50717 DEALLOCATE PREPARE s */;

--
-- Table structure for table `comments`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `comments` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `comment_type` enum('issue','review') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'issue',
  `comment_id` int unsigned NOT NULL,
  `number` int unsigned NOT NULL,
  `user` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `date` int unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`comment_type`,`comment_id`),
  KEY `pull` (`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `commit_statuses`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `commit_statuses` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `commit` char(40) COLLATE utf8mb4_general_ci NOT NULL,
  `state` enum('pending','success','error','failure') COLLATE utf8mb4_general_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `log_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `context` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'default',
  PRIMARY KEY (`repo`,`commit`,`context`),
  KEY `commit_statuses_state` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `issues`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `issues` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `number` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `difficulty` int DEFAULT NULL,
  `milestone_title` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `milestone_due_on` int DEFAULT NULL,
  `assignee` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `date_closed` int DEFAULT NULL,
  `date_created` int DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pull_labels`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pull_labels` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `number` int unsigned NOT NULL,
  `title` varchar(32) COLLATE utf8mb4_general_ci NOT NULL,
  `user` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `date` int unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`,`title`),
  KEY `pull_labels_title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pull_signatures`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pull_signatures` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `number` int unsigned NOT NULL,
  `user` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `type` varchar(32) COLLATE utf8mb4_general_ci NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `comment_id` int unsigned NOT NULL,
  `userid` int unsigned NOT NULL,
  `date` int unsigned DEFAULT NULL,
  KEY `pull_signatures_number` (`repo`,`number`,`active`),
  KEY `pull_signatures_type` (`repo`,`user`,`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `pulls`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `pulls` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL DEFAULT '',
  `number` int unsigned NOT NULL,
  `state` enum('open','closed') COLLATE utf8mb4_general_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `body` text COLLATE utf8mb4_general_ci NOT NULL,
  `draft` boolean,
  `head_branch` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `head_sha` char(40) COLLATE utf8mb4_general_ci NOT NULL,
  `base_branch` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `owner` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `cr_req` int NOT NULL DEFAULT '2',
  `qa_req` int NOT NULL DEFAULT '1',
  `date` int unsigned DEFAULT NULL,
  `date_updated` int unsigned DEFAULT NULL,
  `date_closed` int unsigned DEFAULT NULL,
  `date_merged` int unsigned DEFAULT NULL,
  `milestone_title` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `milestone_due_on` int unsigned DEFAULT NULL,
  `closes` int unsigned DEFAULT NULL,
  `connects` int unsigned DEFAULT NULL,
  `difficulty` int DEFAULT NULL,
  `commits` int unsigned DEFAULT NULL,
  `additions` int unsigned DEFAULT NULL,
  `deletions` int unsigned DEFAULT NULL,
  `changed_files` int unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`number`),
  KEY `pulls_state` (`state`),
  KEY `pulls_repo` (`repo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reviews`
--

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE IF NOT EXISTS `reviews` (
  `repo` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `review_id` int unsigned NOT NULL,
  `number` int unsigned NOT NULL,
  `body` text COLLATE utf8mb4_general_ci,
  `state` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `user` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `date` int unsigned DEFAULT NULL,
  PRIMARY KEY (`repo`,`review_id`),
  KEY `pull` (`number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
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
