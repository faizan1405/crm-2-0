CREATE TABLE `crm_automation_rule_revisions` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`rule_id` varchar(64) NOT NULL,
	`version` int NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(255) NOT NULL DEFAULT '',
	`subject` varchar(24) NOT NULL,
	`trigger_type` varchar(48) NOT NULL,
	`status` varchar(24) NOT NULL,
	`conditions_json` text NOT NULL,
	`actions_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`diff_summary` varchar(255),
	`actor_user_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_automation_rule_revisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_automation_rules` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`description` varchar(255) NOT NULL DEFAULT '',
	`template_id` varchar(64),
	`subject` varchar(24) NOT NULL DEFAULT 'lead',
	`trigger_type` varchar(48) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'draft',
	`paused_reason` varchar(255),
	`conditions_json` text NOT NULL,
	`actions_json` text NOT NULL,
	`settings_json` text NOT NULL,
	`last_evaluated_at` datetime(3),
	`last_triggered_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_automation_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_automation_runs` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`rule_id` varchar(64) NOT NULL,
	`trigger_type` varchar(48) NOT NULL,
	`outcome` varchar(24) NOT NULL,
	`is_simulation` boolean NOT NULL DEFAULT false,
	`lead_id` varchar(64),
	`project_id` varchar(64),
	`matched_count` int NOT NULL DEFAULT 0,
	`skipped_count` int NOT NULL DEFAULT 0,
	`planned_actions_json` text NOT NULL,
	`executed_actions_json` text NOT NULL,
	`execution_error` varchar(255),
	`actor_user_id` varchar(64),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_automation_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_internal_reminders` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`reminder_key` varchar(255) NOT NULL,
	`rule_id` varchar(64),
	`rule_name` varchar(128),
	`lead_id` varchar(64),
	`project_id` varchar(64),
	`task_id` varchar(64),
	`employee_id` varchar(64),
	`reason` varchar(255) NOT NULL,
	`due_at` datetime(3) NOT NULL,
	`importance` varchar(16) NOT NULL DEFAULT 'normal',
	`status` varchar(24) NOT NULL DEFAULT 'open',
	`flag` boolean NOT NULL DEFAULT false,
	`owner_review` boolean NOT NULL DEFAULT false,
	`escalated` boolean NOT NULL DEFAULT false,
	`follow_up_id` varchar(64),
	`resolve_when` varchar(24) NOT NULL DEFAULT 'never',
	`origin` varchar(24) NOT NULL DEFAULT 'automation',
	`history_json` text,
	`closed_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_internal_reminders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_reminders_owner_key` UNIQUE(`owner_user_id`,`reminder_key`)
);
--> statement-breakpoint
ALTER TABLE `crm_automation_rule_revisions` ADD CONSTRAINT `crm_automation_rule_revisions_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_automation_rule_revisions` ADD CONSTRAINT `crm_automation_rule_revisions_rule_id_crm_automation_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `crm_automation_rules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_automation_rule_revisions` ADD CONSTRAINT `crm_automation_rule_revisions_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_automation_rules` ADD CONSTRAINT `crm_automation_rules_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD CONSTRAINT `crm_automation_runs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD CONSTRAINT `crm_automation_runs_rule_id_crm_automation_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `crm_automation_rules`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_automation_runs` ADD CONSTRAINT `crm_automation_runs_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_internal_reminders` ADD CONSTRAINT `crm_internal_reminders_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_internal_reminders` ADD CONSTRAINT `crm_internal_reminders_rule_id_crm_automation_rules_id_fk` FOREIGN KEY (`rule_id`) REFERENCES `crm_automation_rules`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_internal_reminders` ADD CONSTRAINT `crm_internal_reminders_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_internal_reminders` ADD CONSTRAINT `crm_internal_reminders_project_id_crm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `crm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_internal_reminders` ADD CONSTRAINT `crm_internal_reminders_follow_up_id_crm_follow_ups_id_fk` FOREIGN KEY (`follow_up_id`) REFERENCES `crm_follow_ups`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_auto_rev_owner_rule` ON `crm_automation_rule_revisions` (`owner_user_id`,`rule_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_rev_owner_created` ON `crm_automation_rule_revisions` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_rules_owner_status` ON `crm_automation_rules` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_rules_owner_trigger` ON `crm_automation_rules` (`owner_user_id`,`trigger_type`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_rules_owner_subject` ON `crm_automation_rules` (`owner_user_id`,`subject`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_runs_owner_rule` ON `crm_automation_runs` (`owner_user_id`,`rule_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_runs_owner_created` ON `crm_automation_runs` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_auto_runs_owner_sim` ON `crm_automation_runs` (`owner_user_id`,`is_simulation`);--> statement-breakpoint
CREATE INDEX `idx_crm_reminders_owner_status` ON `crm_internal_reminders` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_reminders_owner_due` ON `crm_internal_reminders` (`owner_user_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_reminders_owner_lead` ON `crm_internal_reminders` (`owner_user_id`,`lead_id`);