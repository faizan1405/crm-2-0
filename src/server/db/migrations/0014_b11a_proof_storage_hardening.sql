ALTER TABLE `crm_payment_proofs` ADD `storage_status` varchar(24) DEFAULT 'verified' NOT NULL;--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD `storage_provider_id` varchar(64);--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD `verified_at` datetime(3);--> statement-breakpoint
ALTER TABLE `crm_payment_proofs` ADD `verification_error` varchar(255);--> statement-breakpoint
CREATE INDEX `idx_crm_payment_proofs_storage_status` ON `crm_payment_proofs` (`owner_user_id`,`storage_status`);