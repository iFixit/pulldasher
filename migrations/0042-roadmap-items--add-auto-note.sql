-- Why Pulldasher last changed a plan on its own (shared/model/autoCalls.ts):
-- picked up again, put down, finished, planned or given a lead, and when.
-- NULL on a plan it never changed. A person's write leaves them, so the
-- last automatic call stays readable after someone edits the plan.
ALTER TABLE `roadmap_items` ADD COLUMN `auto_note` varchar(200) COLLATE utf8mb4_general_ci DEFAULT NULL AFTER `removed_at`, ADD COLUMN `auto_at` int unsigned DEFAULT NULL AFTER `auto_note`;
