CREATE TABLE `crm_payment_proof_blobs` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` varchar(64) NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`chunk_index` int NOT NULL,
	`chunk_count` int NOT NULL,
	`chunk_size` int NOT NULL,
	`total_byte_size` int NOT NULL,
	`total_sha256` char(64) NOT NULL,
	`mime_type` varchar(64) NOT NULL,
	`blob_data` longblob NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_payment_proof_blobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_proof_blobs_key_chunk` UNIQUE(`storage_key`,`chunk_index`)
);
--> statement-breakpoint
ALTER TABLE `crm_payment_proof_blobs` ADD CONSTRAINT `crm_payment_proof_blobs_owner_user_id_crm_users_id_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `crm_users`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_proof_blobs_owner_key` ON `crm_payment_proof_blobs` (`owner_user_id`,`storage_key`);