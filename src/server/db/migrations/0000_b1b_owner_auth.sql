CREATE TABLE `crm_auth_audit` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64),
	`event_type` varchar(48) NOT NULL,
	`email_hash` char(64),
	`session_id` varchar(64),
	`ip_prefix` varchar(64),
	`detail` varchar(255),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_auth_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crm_auth_rate_limits` (
	`limit_key` char(64) NOT NULL,
	`attempt_count` int NOT NULL DEFAULT 0,
	`window_started_at` datetime(3) NOT NULL,
	`blocked_until` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_auth_rate_limits_limit_key` PRIMARY KEY(`limit_key`)
);
--> statement-breakpoint
CREATE TABLE `_crm_schema_meta` (
	`meta_key` varchar(64) NOT NULL,
	`meta_value` varchar(255) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `_crm_schema_meta_meta_key` PRIMARY KEY(`meta_key`)
);
--> statement-breakpoint
CREATE TABLE `crm_sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`idle_expires_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`revoke_reason` varchar(64),
	`ip_prefix` varchar(64),
	`user_agent_hash` char(64),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_sessions_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `crm_users` (
	`id` varchar(64) NOT NULL,
	`email` varchar(160) NOT NULL,
	`name` varchar(120) NOT NULL,
	`role_id` varchar(32) NOT NULL DEFAULT 'owner',
	`account_status` varchar(24) NOT NULL DEFAULT 'active',
	`password_hash` varchar(255) NOT NULL,
	`last_login_at` datetime(3),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `crm_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_crm_users_email` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `crm_auth_audit` ADD CONSTRAINT `crm_auth_audit_user_id_crm_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `crm_users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `crm_sessions` ADD CONSTRAINT `crm_sessions_user_id_crm_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `crm_users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_crm_auth_audit_user_id` ON `crm_auth_audit` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_auth_audit_event_at` ON `crm_auth_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_auth_rate_limits_updated_at` ON `crm_auth_rate_limits` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_crm_sessions_user_id` ON `crm_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_crm_sessions_expires_at` ON `crm_sessions` (`expires_at`);