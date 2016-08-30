UPDATE `comments`
SET `date` = NULL
WHERE `date` = 0;

--

UPDATE `issues`
SET `milestone_due_on` = NULL
WHERE `milestone_due_on` = 0;

UPDATE `issues`
SET `date_created` = NULL
WHERE `date_created` = 0;

UPDATE `issues`
SET `date_closed` = NULL
WHERE `date_closed` = 0;

--

UPDATE `pull_labels`
SET `date` = NULL
WHERE `date` = 0;

--

UPDATE `pull_signatures`
SET `date` = NULL
WHERE `date` = 0;

--

UPDATE `pulls`
SET `date_updated` = NULL
WHERE `date_updated` = 0;

UPDATE `pulls`
SET `date_closed` = NULL
WHERE `date_closed` = 0;

UPDATE `pulls`
SET `date_merged` = NULL
WHERE `date_merged` = 0;

UPDATE `pulls`
SET `milestone_due_on` = NULL
WHERE `milestone_due_on` = 0;
