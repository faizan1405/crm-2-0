CREATE TABLE `crm_quotation_audit_events` (
	`id` varchar(64) NOT NULL,
	`quotation_id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`event_type` varchar(48) NOT NULL,
	`summary` varchar(255) NOT NULL,
	`details_json` text,
	`occurred_ist_date` char(10) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_quotation_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_quotation_items` (
	`id` varchar(64) NOT NULL,
	`quotation_id` varchar(64) NOT NULL,
	`description` varchar(500) NOT NULL,
	`quantity` decimal(15,2) NOT NULL DEFAULT '1.00',
	`unit_price` decimal(15,2) NOT NULL DEFAULT '0.00',
	`total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_quotation_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_quotation_milestones` (
	`id` varchar(64) NOT NULL,
	`quotation_id` varchar(64) NOT NULL,
	`label` varchar(160) NOT NULL,
	`percentage` decimal(15,2) NOT NULL DEFAULT '0.00',
	`amount` decimal(15,2) NOT NULL DEFAULT '0.00',
	`due_date` char(10),
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_quotation_milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_quotation_revisions` (
	`id` varchar(64) NOT NULL,
	`quotation_id` varchar(64) NOT NULL,
	`revision_number` int NOT NULL,
	`snapshot_json` text NOT NULL,
	`change_summary` varchar(255),
	`created_by_user_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_quotation_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_qrev_quotation_number` UNIQUE(`quotation_id`,`revision_number`)
);
--> statement-breakpoint
CREATE TABLE `crm_quotation_templates` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`price_type` varchar(32) NOT NULL DEFAULT 'fixed',
	`price_amount` decimal(15,2),
	`price_label` varchar(128),
	`currency` varchar(8) NOT NULL DEFAULT 'INR',
	`message_body` text NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`sort_order` int NOT NULL DEFAULT 0,
	`version` int NOT NULL DEFAULT 1,
	`archived_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_quotation_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_quotations` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64),
	`deal_id` varchar(64),
	`template_id` varchar(64),
	`legacy_id` varchar(64),
	`quotation_number` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`client_name` varchar(160) NOT NULL,
	`client_company` varchar(160),
	`currency` varchar(8) NOT NULL DEFAULT 'INR',
	`subtotal` decimal(15,2) NOT NULL DEFAULT '0.00',
	`discount_type` varchar(16) NOT NULL DEFAULT 'none',
	`discount_value` decimal(15,2) NOT NULL DEFAULT '0.00',
	`discount_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
	`taxable_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
	`gst_enabled` boolean NOT NULL DEFAULT false,
	`gst_rate` decimal(15,2) NOT NULL DEFAULT '0.00',
	`gst_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
	`total_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`issue_ist_date` char(10) NOT NULL,
	`valid_until_ist_date` char(10),
	`payment_terms` text,
	`notes` text,
	`message_body` text,
	`user_confirmed_sent` boolean NOT NULL DEFAULT false,
	`sent_at` datetime(3),
	`accepted_at` datetime(3),
	`rejected_at` datetime(3),
	`idempotency_key` varchar(128),
	`version` int NOT NULL DEFAULT 1,
	`archived_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_quotations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_quotations_owner_number` UNIQUE(`owner_user_id`,`quotation_number`),
	CONSTRAINT `uq_crm_quotations_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`),
	CONSTRAINT `uq_crm_quotations_owner_idem` UNIQUE(`owner_user_id`,`idempotency_key`)
);
--> statement-breakpoint
ALTER TABLE `crm_quotation_audit_events` ADD CONSTRAINT `crm_quotation_audit_events_quotation_id_crm_quotations_id_fk` FOREIGN KEY (`quotation_id`) REFERENCES `crm_quotations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_audit_events` ADD CONSTRAINT `crm_quotation_audit_events_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_audit_events` ADD CONSTRAINT `crm_quotation_audit_events_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_items` ADD CONSTRAINT `crm_quotation_items_quotation_id_crm_quotations_id_fk` FOREIGN KEY (`quotation_id`) REFERENCES `crm_quotations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_milestones` ADD CONSTRAINT `crm_quotation_milestones_quotation_id_crm_quotations_id_fk` FOREIGN KEY (`quotation_id`) REFERENCES `crm_quotations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_revisions` ADD CONSTRAINT `crm_quotation_revisions_quotation_id_crm_quotations_id_fk` FOREIGN KEY (`quotation_id`) REFERENCES `crm_quotations`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_revisions` ADD CONSTRAINT `crm_quotation_revisions_created_by_user_id_crm_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotation_templates` ADD CONSTRAINT `crm_quotation_templates_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotations` ADD CONSTRAINT `crm_quotations_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotations` ADD CONSTRAINT `crm_quotations_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotations` ADD CONSTRAINT `crm_quotations_deal_id_crm_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_quotations` ADD CONSTRAINT `crm_quotations_template_id_crm_quotation_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `crm_quotation_templates`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_qev_owner_quotation` ON `crm_quotation_audit_events` (`owner_user_id`,`quotation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_qev_owner_created` ON `crm_quotation_audit_events` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_qi_quotation_order` ON `crm_quotation_items` (`quotation_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_crm_qm_quotation_order` ON `crm_quotation_milestones` (`quotation_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_crm_qrev_quotation_created` ON `crm_quotation_revisions` (`quotation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_qt_owner_active` ON `crm_quotation_templates` (`owner_user_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `idx_crm_qt_owner_order` ON `crm_quotation_templates` (`owner_user_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_crm_qt_owner_created` ON `crm_quotation_templates` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_quotations_owner_lead` ON `crm_quotations` (`owner_user_id`,`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_quotations_owner_deal` ON `crm_quotations` (`owner_user_id`,`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_quotations_owner_status` ON `crm_quotations` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_quotations_owner_created` ON `crm_quotations` (`owner_user_id`,`created_at`);