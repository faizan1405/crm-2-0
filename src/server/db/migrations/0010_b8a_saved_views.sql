CREATE TABLE `crm_saved_views` (
	`id` varchar(64) NOT NULL,
	`legacy_id` varchar(64),
	`owner_user_id` varchar(64) NOT NULL,
	`name` varchar(80) NOT NULL,
	`visibility` varchar(24) NOT NULL DEFAULT 'company',
	`filter_json` text NOT NULL,
	`sort` varchar(24) NOT NULL DEFAULT 'recent',
	`columns_json` text,
	`archived` boolean NOT NULL DEFAULT false,
	`is_default` boolean NOT NULL DEFAULT false,
	`is_pinned` boolean NOT NULL DEFAULT false,
	`schema_version` int NOT NULL DEFAULT 1,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_saved_views_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_saved_views_owner_legacy` UNIQUE(`owner_user_id`,`legacy_id`)
);
--> statement-breakpoint
ALTER TABLE `crm_saved_views` ADD CONSTRAINT `crm_saved_views_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_saved_views_owner_status` ON `crm_saved_views` (`owner_user_id`,`archived`);