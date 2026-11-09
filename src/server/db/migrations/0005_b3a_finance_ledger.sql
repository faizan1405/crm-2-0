CREATE TABLE `crm_deal_milestones` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`deal_id` varchar(64) NOT NULL,
	`label` varchar(160) NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`due_date` char(10) NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_deal_milestones_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_deal_milestones_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_deals` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64),
	`client_type` varchar(16) NOT NULL,
	`client_name` varchar(160) NOT NULL,
	`company` varchar(160),
	`phone` varchar(32),
	`name` varchar(160) NOT NULL,
	`quoted_amount` decimal(15,2) NOT NULL,
	`final_amount` decimal(15,2) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'active',
	`due_date` char(10),
	`won_at` datetime(3),
	`won_ist_date` char(10),
	`won_date_verified_at` datetime(3),
	`won_date_verified_by_user_id` varchar(64),
	`cancelled_at` datetime(3),
	`cancelled_ist_date` char(10),
	`cancelled_by_user_id` varchar(64),
	`cancel_reason` varchar(500),
	`notes` text,
	`op_id` varchar(128),
	`idempotency_key` varchar(128),
	`created_by_user_id` varchar(64) NOT NULL,
	`updated_by_user_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_deals_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_deals_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_deals_owner_op` UNIQUE(`owner_user_id`,`op_id`),
	CONSTRAINT `uq_crm_deals_owner_idem` UNIQUE(`owner_user_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_finance_events` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`deal_id` varchar(64) NOT NULL,
	`payment_id` varchar(64),
	`lead_id` varchar(64),
	`actor_user_id` varchar(64) NOT NULL,
	`event_type` varchar(48) NOT NULL,
	`summary` varchar(500) NOT NULL,
	`reason` varchar(500),
	`amount_snapshot` decimal(15,2),
	`before_json` text,
	`after_json` text,
	`lead_activity_id` varchar(64),
	`op_id` varchar(128),
	`occurred_at` datetime(3) NOT NULL,
	`occurred_ist_date` char(10) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_finance_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_payments` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`deal_id` varchar(64) NOT NULL,
	`amount` decimal(15,2) NOT NULL,
	`payment_ist_date` char(10) NOT NULL,
	`method` varchar(32) NOT NULL,
	`payment_type` varchar(24) NOT NULL,
	`reference` varchar(160),
	`notes` text,
	`status` varchar(16) NOT NULL DEFAULT 'posted',
	`voided` boolean NOT NULL DEFAULT false,
	`voided_at` datetime(3),
	`voided_ist_date` char(10),
	`voided_by_user_id` varchar(64),
	`void_reason` varchar(500),
	`op_id` varchar(128),
	`idempotency_key` varchar(128),
	`recorded_by_user_id` varchar(64) NOT NULL,
	`updated_by_user_id` varchar(64) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_payments_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_payments_owner_op` UNIQUE(`owner_user_id`,`op_id`),
	CONSTRAINT `uq_crm_payments_owner_deal_idem` UNIQUE(`owner_user_id`,`deal_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `crm_call_logs` DROP FOREIGN KEY `crm_call_logs_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_call_logs` DROP FOREIGN KEY `crm_call_logs_lead_id_crm_leads_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_custom_fields` DROP FOREIGN KEY `crm_custom_fields_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_follow_ups` DROP FOREIGN KEY `crm_follow_ups_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_follow_ups` DROP FOREIGN KEY `crm_follow_ups_lead_id_crm_leads_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_idempotency_keys` DROP FOREIGN KEY `crm_idempotency_keys_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_lead_activities` DROP FOREIGN KEY `crm_lead_activities_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_lead_activities` DROP FOREIGN KEY `crm_lead_activities_lead_id_crm_leads_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` DROP FOREIGN KEY `crm_lead_field_values_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` DROP FOREIGN KEY `crm_lead_field_values_lead_id_crm_leads_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_lead_tags` DROP FOREIGN KEY `crm_lead_tags_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_lead_tags` DROP FOREIGN KEY `crm_lead_tags_lead_id_crm_leads_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_leads` DROP FOREIGN KEY `crm_leads_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_tag_defs` DROP FOREIGN KEY `crm_tag_defs_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` DROP FOREIGN KEY `crm_whatsapp_logs_owner_user_id_crm_users_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` DROP FOREIGN KEY `crm_whatsapp_logs_lead_id_crm_leads_id_fk`;
--> statement-breakpoint
ALTER TABLE `crm_deal_milestones` ADD CONSTRAINT `crm_deal_milestones_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deal_milestones` ADD CONSTRAINT `crm_deal_milestones_deal_id_crm_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deals` ADD CONSTRAINT `crm_deals_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deals` ADD CONSTRAINT `crm_deals_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deals` ADD CONSTRAINT `crm_deals_won_date_verified_by_user_id_crm_users_id_fk` FOREIGN KEY (`won_date_verified_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deals` ADD CONSTRAINT `crm_deals_cancelled_by_user_id_crm_users_id_fk` FOREIGN KEY (`cancelled_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deals` ADD CONSTRAINT `crm_deals_created_by_user_id_crm_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_deals` ADD CONSTRAINT `crm_deals_updated_by_user_id_crm_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_finance_events` ADD CONSTRAINT `crm_finance_events_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_finance_events` ADD CONSTRAINT `crm_finance_events_deal_id_crm_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_finance_events` ADD CONSTRAINT `crm_finance_events_payment_id_crm_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `crm_payments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_finance_events` ADD CONSTRAINT `crm_finance_events_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_finance_events` ADD CONSTRAINT `crm_finance_events_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payments` ADD CONSTRAINT `crm_payments_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payments` ADD CONSTRAINT `crm_payments_deal_id_crm_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payments` ADD CONSTRAINT `crm_payments_voided_by_user_id_crm_users_id_fk` FOREIGN KEY (`voided_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payments` ADD CONSTRAINT `crm_payments_recorded_by_user_id_crm_users_id_fk` FOREIGN KEY (`recorded_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payments` ADD CONSTRAINT `crm_payments_updated_by_user_id_crm_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_deal_milestones_deal_order` ON `crm_deal_milestones` (`deal_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_crm_deal_milestones_owner_due` ON `crm_deal_milestones` (`owner_user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_deals_owner_status_due` ON `crm_deals` (`owner_user_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_deals_owner_lead` ON `crm_deals` (`owner_user_id`,`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_deals_owner_won_ist` ON `crm_deals` (`owner_user_id`,`won_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_deals_owner_created` ON `crm_deals` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_finance_events_deal_occurred` ON `crm_finance_events` (`deal_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_finance_events_payment_occurred` ON `crm_finance_events` (`payment_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_finance_events_owner_occurred` ON `crm_finance_events` (`owner_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_finance_events_owner_ist_date` ON `crm_finance_events` (`owner_user_id`,`occurred_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_payments_deal_voided_date` ON `crm_payments` (`deal_id`,`voided`,`payment_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_payments_owner_ist_date` ON `crm_payments` (`owner_user_id`,`payment_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_payments_owner_created` ON `crm_payments` (`owner_user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `crm_call_logs` ADD CONSTRAINT `crm_call_logs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_call_logs` ADD CONSTRAINT `crm_call_logs_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_custom_fields` ADD CONSTRAINT `crm_custom_fields_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_follow_ups` ADD CONSTRAINT `crm_follow_ups_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_follow_ups` ADD CONSTRAINT `crm_follow_ups_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_idempotency_keys` ADD CONSTRAINT `crm_idempotency_keys_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_activities` ADD CONSTRAINT `crm_lead_activities_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_activities` ADD CONSTRAINT `crm_lead_activities_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` ADD CONSTRAINT `crm_lead_field_values_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_field_values` ADD CONSTRAINT `crm_lead_field_values_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_tags` ADD CONSTRAINT `crm_lead_tags_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_lead_tags` ADD CONSTRAINT `crm_lead_tags_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_leads` ADD CONSTRAINT `crm_leads_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_tag_defs` ADD CONSTRAINT `crm_tag_defs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` ADD CONSTRAINT `crm_whatsapp_logs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` ADD CONSTRAINT `crm_whatsapp_logs_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE restrict ON UPDATE no action;