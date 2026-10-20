-- Look back's time spent reads the PRs marked ready in its window (a former
-- draft opens as work that day); without an index each read scans pulls.
-- One index per file, as 0034-0037, so it lands whole or not at all.
ALTER TABLE `pulls` ADD KEY `pulls_ready_at` (`ready_at`), ALGORITHM=INPLACE, LOCK=NONE;
