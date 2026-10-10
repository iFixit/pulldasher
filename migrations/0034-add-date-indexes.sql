-- The Projects tab's windows (Look back, People, time spent) filter these
-- by date; without an index each read scans the whole table. InnoDB adds
-- them online, so reads and writes go on while they build.
ALTER TABLE `comments` ADD KEY `comments_date` (`date`), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `pull_signatures` ADD KEY `pull_signatures_date` (`date`), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `reviews` ADD KEY `reviews_date` (`date`), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE `pulls`
  ADD KEY `pulls_date` (`date`),
  ADD KEY `pulls_date_merged` (`date_merged`),
  ALGORITHM=INPLACE, LOCK=NONE;
