-- The Projects windows (Look back, People, time spent) filter this table by
-- date; without an index each read scans it. One index per file, so each
-- migration is one statement that either lands whole or not at all, and
-- bin/migrate-missing can run it again after a failure. InnoDB builds it
-- online.
ALTER TABLE `pulls`
  ADD KEY `pulls_date` (`date`),
  ADD KEY `pulls_date_merged` (`date_merged`),
  ALGORITHM=INPLACE, LOCK=NONE;
