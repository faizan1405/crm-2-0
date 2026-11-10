CREATE TABLE `crm_client_support_tickets` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`project_id` varchar(64) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`priority` varchar(16) NOT NULL DEFAULT 'normal',
	`assignee_id` varchar(64),
	`due_date` char(10),
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`resolution` text,
	`resolved_at` datetime(3),
	`resolved_by_user_id` varchar(64),
	`coverage` varchar(32) NOT NULL DEFAULT 'undecided',
	`idempotency_key` varchar(128),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_client_support_tickets_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_cst_owner_idem` UNIQUE(`owner_user_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_project_audit_events` (
	`id` varchar(64) NOT NULL,
	`project_id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`actor_user_id` varchar(64) NOT NULL,
	`event_type` varchar(64) NOT NULL,
	`summary` varchar(255) NOT NULL,
	`details_json` text,
	`occurred_ist_date` char(10) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_project_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_project_deliverable_revisions` (
	`id` varchar(64) NOT NULL,
	`deliverable_id` varchar(64) NOT NULL,
	`revision_number` int NOT NULL,
	`title` varchar(255),
	`summary` varchar(255) NOT NULL,
	`file_url` varchar(1024),
	`notes` text,
	`client_feedback` text,
	`status` varchar(32) NOT NULL DEFAULT 'submitted',
	`created_by_user_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_project_deliverable_revisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_pdr_deliv_rev` UNIQUE(`deliverable_id`,`revision_number`)
);
--> statement-breakpoint
CREATE TABLE `crm_project_deliverables` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`project_id` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`category` varchar(64) NOT NULL DEFAULT 'general',
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`due_date` char(10),
	`delivered_at` datetime(3),
	`revision_count` int NOT NULL DEFAULT 0,
	`latest_revision_notes` text,
	`client_feedback` text,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_project_deliverables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_project_milestones` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`project_id` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`due_date` char(10),
	`sort_order` int NOT NULL DEFAULT 0,
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`completed_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_project_milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_project_tasks` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`project_id` varchar(64) NOT NULL,
	`milestone_id` varchar(64),
	`title` varchar(255) NOT NULL,
	`notes` text,
	`assignee_id` varchar(64),
	`due_date` char(10),
	`priority` varchar(16) NOT NULL DEFAULT 'normal',
	`status` varchar(16) NOT NULL DEFAULT 'open',
	`completed_at` datetime(3),
	`completed_by` varchar(64),
	`sort_order` int NOT NULL DEFAULT 0,
	`idempotency_key` varchar(128),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_project_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_pt_owner_idem` UNIQUE(`owner_user_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_project_templates` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(160) NOT NULL,
	`type` varchar(160) NOT NULL,
	`built_in` boolean NOT NULL DEFAULT false,
	`milestones_json` text NOT NULL,
	`tasks_json` text NOT NULL,
	`requirements_json` text NOT NULL,
	`qa_json` text NOT NULL,
	`handover_json` text NOT NULL,
	`archived` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_project_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_projects` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`client_name` varchar(160) NOT NULL,
	`company` varchar(160),
	`phone` varchar(40),
	`email` varchar(160),
	`lead_id` varchar(64),
	`deal_id` varchar(64),
	`template_id` varchar(64),
	`legacy_id` varchar(64),
	`type` varchar(160) NOT NULL,
	`scope` text,
	`booking_date` char(10),
	`planned_start` char(10),
	`actual_start` char(10),
	`target_delivery` char(10),
	`status` varchar(32) NOT NULL DEFAULT 'accepted',
	`stage` varchar(32) NOT NULL DEFAULT 'discovery',
	`priority` varchar(16) NOT NULL DEFAULT 'normal',
	`project_owner_id` varchar(64),
	`member_ids_json` text,
	`dependencies_json` text,
	`requirements_json` text,
	`qa_json` text,
	`handover_json` text,
	`links_json` text,
	`delivery_json` text,
	`support_json` text,
	`carried_json` text,
	`notes` text,
	`review_flag` varchar(255),
	`attention_json` text,
	`archived` boolean NOT NULL DEFAULT false,
	`archived_at` datetime(3),
	`idempotency_key` varchar(128),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_projects_owner_idem` UNIQUE(`owner_user_id`,`idempotency_key`),
	CONSTRAINT `uq_crm_projects_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`)
);
--> statement-breakpoint
ALTER TABLE `crm_client_support_tickets` ADD CONSTRAINT `crm_client_support_tickets_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_client_support_tickets` ADD CONSTRAINT `crm_client_support_tickets_project_id_crm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `crm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_client_support_tickets` ADD CONSTRAINT `crm_client_support_tickets_resolved_by_user_id_crm_users_id_fk` FOREIGN KEY (`resolved_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_audit_events` ADD CONSTRAINT `crm_project_audit_events_project_id_crm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `crm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_audit_events` ADD CONSTRAINT `crm_project_audit_events_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_audit_events` ADD CONSTRAINT `crm_project_audit_events_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_deliverable_revisions` ADD CONSTRAINT `crm_pdr_deliverable_id_fk` FOREIGN KEY (`deliverable_id`) REFERENCES `crm_project_deliverables`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_deliverable_revisions` ADD CONSTRAINT `crm_pdr_created_by_user_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_deliverables` ADD CONSTRAINT `crm_project_deliverables_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_deliverables` ADD CONSTRAINT `crm_project_deliverables_project_id_crm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `crm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_milestones` ADD CONSTRAINT `crm_project_milestones_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_milestones` ADD CONSTRAINT `crm_project_milestones_project_id_crm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `crm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_tasks` ADD CONSTRAINT `crm_project_tasks_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_tasks` ADD CONSTRAINT `crm_project_tasks_project_id_crm_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `crm_projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_tasks` ADD CONSTRAINT `crm_project_tasks_milestone_id_crm_project_milestones_id_fk` FOREIGN KEY (`milestone_id`) REFERENCES `crm_project_milestones`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_project_templates` ADD CONSTRAINT `crm_project_templates_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_projects` ADD CONSTRAINT `crm_projects_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_projects` ADD CONSTRAINT `crm_projects_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_projects` ADD CONSTRAINT `crm_projects_deal_id_crm_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_projects` ADD CONSTRAINT `crm_projects_template_id_crm_project_templates_id_fk` FOREIGN KEY (`template_id`) REFERENCES `crm_project_templates`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_cst_owner_project_status` ON `crm_client_support_tickets` (`owner_user_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_cst_owner_status` ON `crm_client_support_tickets` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_cst_owner_priority` ON `crm_client_support_tickets` (`owner_user_id`,`priority`);--> statement-breakpoint
CREATE INDEX `idx_crm_pae_owner_project` ON `crm_project_audit_events` (`owner_user_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_pae_owner_type` ON `crm_project_audit_events` (`owner_user_id`,`event_type`);--> statement-breakpoint
CREATE INDEX `idx_crm_pae_owner_created` ON `crm_project_audit_events` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_pdr_deliv_created` ON `crm_project_deliverable_revisions` (`deliverable_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_pdel_owner_project` ON `crm_project_deliverables` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_pdel_owner_status` ON `crm_project_deliverables` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_pdel_project_created` ON `crm_project_deliverables` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_pm_project_order` ON `crm_project_milestones` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_crm_pm_owner_project` ON `crm_project_milestones` (`owner_user_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_pt_project_order` ON `crm_project_tasks` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_crm_pt_project_milestone` ON `crm_project_tasks` (`project_id`,`milestone_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_pt_owner_project_status` ON `crm_project_tasks` (`owner_user_id`,`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_pt_owner_due` ON `crm_project_tasks` (`owner_user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_crm_ptpl_owner` ON `crm_project_templates` (`owner_user_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_ptpl_owner_archived` ON `crm_project_templates` (`owner_user_id`,`archived`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_lead` ON `crm_projects` (`owner_user_id`,`lead_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_deal` ON `crm_projects` (`owner_user_id`,`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_status` ON `crm_projects` (`owner_user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_stage` ON `crm_projects` (`owner_user_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_archived` ON `crm_projects` (`owner_user_id`,`archived`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_target` ON `crm_projects` (`owner_user_id`,`target_delivery`);--> statement-breakpoint
CREATE INDEX `idx_crm_projects_owner_created` ON `crm_projects` (`owner_user_id`,`created_at`);