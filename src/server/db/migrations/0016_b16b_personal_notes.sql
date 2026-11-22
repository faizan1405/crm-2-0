CREATE TABLE `crm_personal_notes` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`title` varchar(200) NOT NULL DEFAULT '',
	`body_text` text NOT NULL,
	`doc_json` text NOT NULL,
	`tags_json` text NOT NULL,
	`color` varchar(24),
	`is_pinned` boolean NOT NULL DEFAULT false,
	`linked_lead_id` varchar(64),
	`linked_project_id` varchar(64),
	`version` int NOT NULL DEFAULT 1,
	`archived_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_personal_notes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `crm_personal_notes` ADD CONSTRAINT `crm_personal_notes_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_personal_notes` ADD CONSTRAINT `crm_personal_notes_linked_lead_id_crm_leads_id_fk` FOREIGN KEY (`linked_lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_personal_notes` ADD CONSTRAINT `crm_personal_notes_linked_project_id_crm_projects_id_fk` FOREIGN KEY (`linked_project_id`) REFERENCES `crm_projects`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_personal_notes_owner_updated` ON `crm_personal_notes` (`owner_user_id`,`is_pinned`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_personal_notes_owner_lead` ON `crm_personal_notes` (`owner_user_id`,`linked_lead_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_personal_notes_owner_project` ON `crm_personal_notes` (`owner_user_id`,`linked_project_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_personal_notes_owner_archived` ON `crm_personal_notes` (`owner_user_id`,`archived_at`);