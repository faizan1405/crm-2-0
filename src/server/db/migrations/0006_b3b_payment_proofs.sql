CREATE TABLE `crm_payment_proofs` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`payment_id` varchar(64) NOT NULL,
	`deal_id` varchar(64) NOT NULL,
	`legacy_attachment_id` varchar(128),
	`original_file_name` varchar(255) NOT NULL,
	`file_extension` varchar(16) NOT NULL,
	`mime_type` varchar(64) NOT NULL,
	`file_size` int NOT NULL,
	`sha256_hash` char(64) NOT NULL,
	`storage_driver` varchar(32) NOT NULL DEFAULT 'local-fs',
	`storage_key` varchar(255) NOT NULL,
	`lifecycle_status` varchar(24) NOT NULL DEFAULT 'active',
	`active_payment_lock` varchar(64),
	`replaced_by_proof_id` varchar(64),
	`replacement_reason` text,
	`removal_reason` text,
	`uploaded_by_user_id` varchar(64) NOT NULL,
	`removed_by_user_id` varchar(64),
	`version` int NOT NULL DEFAULT 1,
	`uploaded_at` datetime(3) NOT NULL,
	`removed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_payment_proofs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_payment_proofs_active_pay` UNIQUE(`owner_user_id`,`active_payment_lock`)
);
--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD CONSTRAINT `crm_payment_proofs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD CONSTRAINT `crm_payment_proofs_payment_id_crm_payments_id_fk` FOREIGN KEY (`payment_id`) REFERENCES `crm_payments`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD CONSTRAINT `crm_payment_proofs_deal_id_crm_deals_id_fk` FOREIGN KEY (`deal_id`) REFERENCES `crm_deals`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD CONSTRAINT `crm_payment_proofs_replaced_by_proof_id_crm_payment_proofs_id_fk` FOREIGN KEY (`replaced_by_proof_id`) REFERENCES `crm_payment_proofs`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD CONSTRAINT `crm_payment_proofs_uploaded_by_user_id_crm_users_id_fk` FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD CONSTRAINT `crm_payment_proofs_removed_by_user_id_crm_users_id_fk` FOREIGN KEY (`removed_by_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_payment_proofs_owner_payment` ON `crm_payment_proofs` (`owner_user_id`,`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_payment_proofs_owner_deal` ON `crm_payment_proofs` (`owner_user_id`,`deal_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_payment_proofs_sha256` ON `crm_payment_proofs` (`sha256_hash`);--> statement-breakpoint
CREATE INDEX `idx_crm_payment_proofs_storage_key` ON `crm_payment_proofs` (`storage_key`);