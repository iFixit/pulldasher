ALTER TABLE `comments`
ADD COLUMN `comment_type` ENUM('issue', 'review') DEFAULT 'issue' FIRST,
DROP PRIMARY KEY,
ADD PRIMARY KEY (`comment_type`, `comment_id`);
