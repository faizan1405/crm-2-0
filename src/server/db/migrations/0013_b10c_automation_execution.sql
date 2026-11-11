ALTER TABLE `crm_automation_runs` ADD `execution_key` varchar(128);--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD `rule_version` int;--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD `causation_id` varchar(128);--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD `depth` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD CONSTRAINT `uq_crm_auto_runs_owner_exec_key` UNIQUE(`owner_user_id`,`execution_key`);