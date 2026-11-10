CREATE TABLE `crm_owner_settings` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`owner_display_name` varchar(120),
	`business_name` varchar(160),
	`profile_email` varchar(191),
	`business_phone` varchar(32),
	`business_website` varchar(255),
	`business_address` text,
	`gstin` varchar(32),
	`payment_instructions` text,
	`business_timezone` varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
	`currency_code` varchar(8) NOT NULL DEFAULT 'INR',
	`default_lead_sort` varchar(24) NOT NULL DEFAULT 'recent',
	`notify_follow_ups` boolean NOT NULL DEFAULT true,
	`notify_payments` boolean NOT NULL DEFAULT true,
	`notify_digest` boolean NOT NULL DEFAULT false,
	`notify_goal_achieved` boolean NOT NULL DEFAULT true,
	`notify_team_goal` boolean NOT NULL DEFAULT true,
	`notify_milestone` boolean NOT NULL DEFAULT false,
	`notify_overdue` boolean NOT NULL DEFAULT true,
	`overdue_threshold` int NOT NULL DEFAULT 10,
	`updated_by_user_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_owner_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_os_owner` UNIQUE(`owner_user_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_sales_goal_revisions` (
	`id` varchar(64) NOT NULL,
	`goal_id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`revision_number` int NOT NULL,
	`event_type` varchar(32) NOT NULL,
	`effective_from_ist` char(10) NOT NULL,
	`snapshot_json` text NOT NULL,
	`change_summary` varchar(255) NOT NULL,
	`occurred_ist_date` char(10) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_sales_goal_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_sgr_goal_rev` UNIQUE(`goal_id`,`revision_number`)
);
--> statement-breakpoint
CREATE TABLE `crm_sales_goals` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`metric` varchar(48) NOT NULL,
	`scope` varchar(24) NOT NULL DEFAULT 'owner',
	`target_unit` varchar(16) NOT NULL,
	`target_count` int,
	`target_amount` decimal(15,2),
	`period` varchar(24) NOT NULL,
	`custom_from_ist` char(10),
	`custom_to_ist` char(10),
	`effective_from_ist` char(10) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'active',
	`archived_at` datetime(3),
	`archive_reason` varchar(255),
	`idempotency_key` varchar(128),
	`created_by_user_id` varchar(64) NOT NULL,
	`updated_by_user_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_sales_goals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_sg_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_sg_owner_idem` UNIQUE(`owner_user_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_settings_audit_events` (
	`id` varchar(64) NOT NULL,
	`settings_id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`section` varchar(32) NOT NULL,
	`event_type` varchar(48) NOT NULL,
	`summary` varchar(255) NOT NULL,
	`changed_fields_json` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`version_before` int NOT NULL,
	`version_after` int NOT NULL,
	`occurred_ist_date` char(10) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_settings_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `crm_owner_settings` ADD CONSTRAINT `crm_owner_settings_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_owner_settings` ADD CONSTRAINT `crm_owner_settings_updated_by_user_id_crm_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sales_goal_revisions` ADD CONSTRAINT `crm_sales_goal_revisions_goal_id_crm_sales_goals_id_fk` FOREIGN KEY (`goal_id`) REFERENCES `crm_sales_goals`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sales_goal_revisions` ADD CONSTRAINT `crm_sales_goal_revisions_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sales_goal_revisions` ADD CONSTRAINT `crm_sales_goal_revisions_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sales_goals` ADD CONSTRAINT `crm_sales_goals_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sales_goals` ADD CONSTRAINT `crm_sales_goals_created_by_user_id_crm_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sales_goals` ADD CONSTRAINT `crm_sales_goals_updated_by_user_id_crm_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_settings_audit_events` ADD CONSTRAINT `crm_settings_audit_events_settings_id_crm_owner_settings_id_fk` FOREIGN KEY (`settings_id`) REFERENCES `crm_owner_settings`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_settings_audit_events` ADD CONSTRAINT `crm_settings_audit_events_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_settings_audit_events` ADD CONSTRAINT `crm_settings_audit_events_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_sgr_owner_goal_rev` ON `crm_sales_goal_revisions` (`owner_user_id`,`goal_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `idx_crm_sgr_owner_effective` ON `crm_sales_goal_revisions` (`owner_user_id`,`goal_id`,`effective_from_ist`);--> statement-breakpoint
CREATE INDEX `idx_crm_sg_owner_status` ON `crm_sales_goals` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_sg_owner_metric` ON `crm_sales_goals` (`owner_user_id`,`metric`);--> statement-breakpoint
CREATE INDEX `idx_crm_sg_owner_created` ON `crm_sales_goals` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_sae_owner_created` ON `crm_settings_audit_events` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_sae_settings_created` ON `crm_settings_audit_events` (`settings_id`,`created_at`);