CREATE TABLE `crm_whatsapp_logs` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`purpose` varchar(24) NOT NULL,
	`template_id` varchar(64),
	`template_name` varchar(120),
	`recipient_phone` varchar(20) NOT NULL,
	`message_text` text NOT NULL,
	`confirmation_status` varchar(32) NOT NULL DEFAULT 'owner_confirmed_sent',
	`composer_source` varchar(64) NOT NULL,
	`lead_activity_id` varchar(64) NOT NULL,
	`op_id` varchar(128),
	`idempotency_key` varchar(128),
	`confirmed_at` datetime(3) NOT NULL,
	`confirmed_ist_date` char(10) NOT NULL,
	`confirmed_ist_time` char(5) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_whatsapp_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_wa_logs_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_wa_logs_owner_op` UNIQUE(`owner_user_id`,`op_id`),
	CONSTRAINT `uq_crm_wa_logs_owner_idem` UNIQUE(`owner_user_id`,`lead_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` ADD CONSTRAINT `crm_whatsapp_logs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` ADD CONSTRAINT `crm_whatsapp_logs_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_whatsapp_logs` ADD CONSTRAINT `crm_whatsapp_logs_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_wa_logs_lead_confirmed` ON `crm_whatsapp_logs` (`lead_id`,`confirmed_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_wa_logs_owner_confirmed` ON `crm_whatsapp_logs` (`owner_user_id`,`confirmed_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_wa_logs_owner_ist_date` ON `crm_whatsapp_logs` (`owner_user_id`,`confirmed_ist_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_wa_logs_activity` ON `crm_whatsapp_logs` (`lead_activity_id`);