CREATE TABLE `crm_custom_fields` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`entity` varchar(16) NOT NULL DEFAULT 'lead',
	`label` varchar(80) NOT NULL,
	`field_type` varchar(24) NOT NULL,
	`description` varchar(255),
	`required` boolean NOT NULL DEFAULT false,
	`default_value_json` text,
	`options_json` text NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`highlight` boolean NOT NULL DEFAULT false,
	`visibility` varchar(16) NOT NULL DEFAULT 'team',
	`editable` varchar(16) NOT NULL DEFAULT 'team',
	`currency` varchar(8),
	`history_json` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_custom_fields_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_custom_fields_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_follow_ups` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`active_lead_lock` varchar(64),
	`type` varchar(24) NOT NULL,
	`due_at` datetime(3) NOT NULL,
	`due_ist_date` char(10) NOT NULL,
	`due_ist_time` char(5) NOT NULL,
	`note` varchar(1000),
	`completed_at` datetime(3),
	`cancelled_at` datetime(3),
	`cancel_reason` varchar(255),
	`replaced_by_id` varchar(64),
	`op_id` varchar(128),
	`created_by_user_id` varchar(64) NOT NULL,
	`updated_by_user_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_follow_ups_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_follow_ups_active_lead` UNIQUE(`active_lead_lock`),
	CONSTRAINT `uq_crm_follow_ups_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_follow_ups_owner_op` UNIQUE(`owner_user_id`,`op_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_idempotency_keys` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`scope` varchar(48) NOT NULL,
	`idem_key` varchar(128) NOT NULL,
	`request_hash` char(64) NOT NULL,
	`resource_id` varchar(64),
	`response_status` int NOT NULL,
	`response_body_json` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_idempotency_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_idempotency_owner_scope_key` UNIQUE(`owner_user_id`,`scope`,`idem_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_lead_activities` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`type` varchar(24) NOT NULL,
	`text` text NOT NULL,
	`outcome` varchar(48),
	`op_id` varchar(128),
	`idempotency_key` varchar(128),
	`occurred_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_lead_activities_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_lead_activities_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_lead_activities_owner_lead_idem` UNIQUE(`owner_user_id`,`lead_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_lead_field_values` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`field_id` varchar(64) NOT NULL,
	`value_json` text NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_lead_field_values_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_lead_field_values_lead_field` UNIQUE(`lead_id`,`field_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_lead_tags` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`tag_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_lead_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_lead_tags_lead_tag` UNIQUE(`lead_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_leads` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`phone` varchar(32) NOT NULL,
	`phone_key` varchar(20) NOT NULL,
	`email` varchar(160),
	`email_normalized` varchar(160),
	`company` varchar(160),
	`requirement` text,
	`source` varchar(32) NOT NULL,
	`status` varchar(24) NOT NULL,
	`priority` varchar(16) NOT NULL,
	`ai_score` int,
	`quoted_amount` decimal(15,2),
	`budget` decimal(15,2),
	`last_contact_at` datetime(3),
	`next_follow_up_at` datetime(3),
	`notes` text,
	`pinned` boolean NOT NULL DEFAULT false,
	`quick_status` varchar(32),
	`lost_reason` varchar(500),
	`lifecycle_status` varchar(16) NOT NULL DEFAULT 'active',
	`archived_at` datetime(3),
	`archive_reason` varchar(500),
	`created_by_user_id` varchar(64) NOT NULL,
	`updated_by_user_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_leads_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_tag_defs` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(48) NOT NULL,
	`description` varchar(255),
	`color` varchar(16) NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'active',
	`scope` varchar(16) NOT NULL DEFAULT 'lead',
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_tag_defs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_tag_defs_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`)
);
--> statement-breakpoint
ALTER TABLE `crm_custom_fields` ADD CONSTRAINT `crm_custom_fields_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_follow_ups` ADD CONSTRAINT `crm_follow_ups_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_follow_ups` ADD CONSTRAINT `crm_follow_ups_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_follow_ups` ADD CONSTRAINT `crm_follow_ups_created_by_user_id_crm_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_follow_ups` ADD CONSTRAINT `crm_follow_ups_updated_by_user_id_crm_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_idempotency_keys` ADD CONSTRAINT `crm_idempotency_keys_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_activities` ADD CONSTRAINT `crm_lead_activities_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_activities` ADD CONSTRAINT `crm_lead_activities_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_activities` ADD CONSTRAINT `crm_lead_activities_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` ADD CONSTRAINT `crm_lead_field_values_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` ADD CONSTRAINT `crm_lead_field_values_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` ADD CONSTRAINT `crm_lead_field_values_field_id_crm_custom_fields_id_fk` FOREIGN KEY (`field_id`) REFERENCES `crm_custom_fields`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_tags` ADD CONSTRAINT `crm_lead_tags_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_tags` ADD CONSTRAINT `crm_lead_tags_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_tags` ADD CONSTRAINT `crm_lead_tags_tag_id_crm_tag_defs_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `crm_tag_defs`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_created_by_user_id_crm_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_updated_by_user_id_crm_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_tag_defs` ADD CONSTRAINT `crm_tag_defs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_custom_fields_owner_entity` ON `crm_custom_fields` (`owner_user_id`,`entity`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_follow_ups_lead_due` ON `crm_follow_ups` (`lead_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_follow_ups_owner_due` ON `crm_follow_ups` (`owner_user_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_follow_ups_owner_ist_date` ON `crm_follow_ups` (`owner_user_id`,`due_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_idempotency_expires_at` ON `crm_idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_lead_activities_lead_occurred` ON `crm_lead_activities` (`lead_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_lead_activities_owner_occurred` ON `crm_lead_activities` (`owner_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_lead_field_values_owner_field` ON `crm_lead_field_values` (`owner_user_id`,`field_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_lead_tags_owner_tag` ON `crm_lead_tags` (`owner_user_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_owner_lifecycle_phone` ON `crm_leads` (`owner_user_id`,`lifecycle_status`,`phone_key`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_owner_lifecycle_email` ON `crm_leads` (`owner_user_id`,`lifecycle_status`,`email_normalized`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_owner_lifecycle_status` ON `crm_leads` (`owner_user_id`,`lifecycle_status`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_owner_next_followup` ON `crm_leads` (`owner_user_id`,`lifecycle_status`,`next_follow_up_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_owner_created` ON `crm_leads` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_leads_owner_updated` ON `crm_leads` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_tag_defs_owner_status` ON `crm_tag_defs` (`owner_user_id`,`status`);