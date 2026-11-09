CREATE TABLE `crm_call_logs` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`outcome` varchar(48) NOT NULL,
	`connected` boolean NOT NULL,
	`recording_source` varchar(24) NOT NULL DEFAULT 'user_recorded',
	`notes` text,
	`dial_source` varchar(64) NOT NULL,
	`stage_before` varchar(24) NOT NULL,
	`stage_after` varchar(24) NOT NULL,
	`quick_status_before` varchar(32),
	`quick_status_after` varchar(32),
	`lead_activity_id` varchar(64) NOT NULL,
	`op_id` varchar(128),
	`idempotency_key` varchar(128),
	`occurred_at` datetime(3) NOT NULL,
	`occurred_ist_date` char(10) NOT NULL,
	`occurred_ist_time` char(5) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_call_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_call_logs_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_call_logs_owner_op` UNIQUE(`owner_user_id`,`op_id`),
	CONSTRAINT `uq_crm_call_logs_owner_idem` UNIQUE(`owner_user_id`,`lead_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `crm_call_logs` ADD CONSTRAINT `crm_call_logs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_call_logs` ADD CONSTRAINT `crm_call_logs_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_call_logs` ADD CONSTRAINT `crm_call_logs_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_call_logs_lead_occurred` ON `crm_call_logs` (`lead_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_call_logs_owner_occurred` ON `crm_call_logs` (`owner_user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_call_logs_owner_ist_date` ON `crm_call_logs` (`owner_user_id`,`occurred_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_call_logs_activity` ON `crm_call_logs` (`lead_activity_id`);