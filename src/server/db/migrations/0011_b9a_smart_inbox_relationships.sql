CREATE TABLE `crm_lead_inbox_items` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`lead_id` varchar(64) NOT NULL,
	`status` varchar(24) NOT NULL DEFAULT 'needs_review',
	`reviewed_at` datetime(3),
	`flagged_at` datetime(3),
	`flag_note` varchar(255),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_lead_inbox_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_lead_inbox_items_owner_lead` UNIQUE(`owner_user_id`,`lead_id`)
);
--> statement-breakpoint
CREATE TABLE `crm_duplicate_candidates` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`lead_a_id` varchar(64) NOT NULL,
	`lead_b_id` varchar(64) NOT NULL,
	`pair_key` varchar(130) NOT NULL,
	`reasons_json` varchar(255) NOT NULL,
	`strength` varchar(16) NOT NULL DEFAULT 'suggested',
	`status` varchar(24) NOT NULL DEFAULT 'pending',
	`pair_signature` varchar(255) NOT NULL,
	`reopened` boolean NOT NULL DEFAULT false,
	`decision_kind` varchar(24),
	`decision_note` varchar(255),
	`decided_at` datetime(3),
	`decided_by_user_id` varchar(64),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_duplicate_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_dup_candidates_owner_pair` UNIQUE(`owner_user_id`,`pair_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_lead_relationships` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`lead_a_id` varchar(64) NOT NULL,
	`lead_b_id` varchar(64) NOT NULL,
	`pair_key` varchar(130) NOT NULL,
	`kind` varchar(24) NOT NULL,
	`signature` varchar(255) NOT NULL,
	`note` varchar(255),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_lead_relationships_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_lead_rel_owner_pair` UNIQUE(`owner_user_id`,`pair_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_lead_relationship_history` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`pair_key` varchar(130),
	`lead_a_id` varchar(64),
	`lead_b_id` varchar(64),
	`candidate_id` varchar(64),
	`action` varchar(32) NOT NULL,
	`kind` varchar(24),
	`previous_kind` varchar(24),
	`signature` varchar(255),
	`note` varchar(255),
	`actor_user_id` varchar(64) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_lead_relationship_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `crm_lead_inbox_items` ADD CONSTRAINT `crm_lead_inbox_items_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_lead_inbox_items` ADD CONSTRAINT `crm_lead_inbox_items_lead_id_crm_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_duplicate_candidates` ADD CONSTRAINT `crm_duplicate_candidates_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_duplicate_candidates` ADD CONSTRAINT `crm_duplicate_candidates_lead_a_id_crm_leads_id_fk` FOREIGN KEY (`lead_a_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_duplicate_candidates` ADD CONSTRAINT `crm_duplicate_candidates_lead_b_id_crm_leads_id_fk` FOREIGN KEY (`lead_b_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_duplicate_candidates` ADD CONSTRAINT `crm_duplicate_candidates_decided_by_user_id_crm_users_id_fk` FOREIGN KEY (`decided_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_lead_relationships` ADD CONSTRAINT `crm_lead_relationships_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_lead_relationships` ADD CONSTRAINT `crm_lead_relationships_lead_a_id_crm_leads_id_fk` FOREIGN KEY (`lead_a_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_lead_relationships` ADD CONSTRAINT `crm_lead_relationships_lead_b_id_crm_leads_id_fk` FOREIGN KEY (`lead_b_id`) REFERENCES `crm_leads`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_lead_relationship_history` ADD CONSTRAINT `crm_lead_relationship_history_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `crm_lead_relationship_history` ADD CONSTRAINT `crm_lead_relationship_history_actor_user_id_crm_users_id_fk` FOREIGN KEY (`actor_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_crm_lead_inbox_items_owner_status` ON `crm_lead_inbox_items` (`owner_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_crm_lead_inbox_items_owner_reviewed` ON `crm_lead_inbox_items` (`owner_user_id`,`reviewed_at`);
--> statement-breakpoint
CREATE INDEX `idx_crm_dup_candidates_owner_status` ON `crm_duplicate_candidates` (`owner_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_crm_dup_candidates_owner_lead_a` ON `crm_duplicate_candidates` (`owner_user_id`,`lead_a_id`);
--> statement-breakpoint
CREATE INDEX `idx_crm_dup_candidates_owner_lead_b` ON `crm_duplicate_candidates` (`owner_user_id`,`lead_b_id`);
--> statement-breakpoint
CREATE INDEX `idx_crm_lead_rel_owner_kind` ON `crm_lead_relationships` (`owner_user_id`,`kind`);
--> statement-breakpoint
CREATE INDEX `idx_crm_lead_rel_owner_lead_a` ON `crm_lead_relationships` (`owner_user_id`,`lead_a_id`);
--> statement-breakpoint
CREATE INDEX `idx_crm_lead_rel_owner_lead_b` ON `crm_lead_relationships` (`owner_user_id`,`lead_b_id`);
--> statement-breakpoint
CREATE INDEX `idx_crm_inbox_audit_owner_pair` ON `crm_lead_relationship_history` (`owner_user_id`,`pair_key`);
--> statement-breakpoint
CREATE INDEX `idx_crm_inbox_audit_owner_created` ON `crm_lead_relationship_history` (`owner_user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_crm_inbox_audit_owner_action` ON `crm_lead_relationship_history` (`owner_user_id`,`action`);
