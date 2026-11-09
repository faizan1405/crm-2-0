import { char, index, int, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { auditTimestamps, crmId, utcDateTime, versionCol } from "./conventions.server";

/**
 * Foundation metadata table validated in Checkpoint B1A.
 */
export const crmSchemaMeta = mysqlTable("_crm_schema_meta", {
  metaKey: varchar("meta_key", { length: 64 }).primaryKey(),
  metaValue: varchar("meta_value", { length: 255 }).notNull(),
  version: versionCol("version"),
  ...auditTimestamps(),
});

/**
 * B1B: Authenticated user accounts (Owner-only in B1B; Employee login deferred).
 */
export const crmUsers = mysqlTable(
  "crm_users",
  {
    id: crmId("id").primaryKey(),
    email: varchar("email", { length: 160 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    roleId: varchar("role_id", { length: 32 }).notNull().default("owner"),
    accountStatus: varchar("account_status", { length: 24 }).notNull().default("active"),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    lastLoginAt: utcDateTime("last_login_at"),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [uniqueIndex("uq_crm_users_email").on(table.email)],
);

/**
 * B1B: Server-managed sessions storing ONLY SHA-256 hashes of opaque HttpOnly tokens.
 */
export const crmSessions = mysqlTable(
  "crm_sessions",
  {
    id: crmId("id").primaryKey(),
    userId: crmId("user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "cascade" }),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: utcDateTime("expires_at").notNull(),
    idleExpiresAt: utcDateTime("idle_expires_at").notNull(),
    lastSeenAt: utcDateTime("last_seen_at").notNull(),
    revokedAt: utcDateTime("revoked_at"),
    revokeReason: varchar("revoke_reason", { length: 64 }),
    ipPrefix: varchar("ip_prefix", { length: 64 }),
    userAgentHash: char("user_agent_hash", { length: 64 }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_sessions_token_hash").on(table.tokenHash),
    index("idx_crm_sessions_user_id").on(table.userId),
    index("idx_crm_sessions_expires_at").on(table.expiresAt),
  ],
);

/**
 * B1B: Append-only authentication audit log (no plaintext emails/passwords/tokens stored).
 */
export const crmAuthAudit = mysqlTable(
  "crm_auth_audit",
  {
    id: crmId("id").primaryKey(),
    userId: crmId("user_id").references(() => crmUsers.id, { onDelete: "set null" }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    emailHash: char("email_hash", { length: 64 }),
    sessionId: crmId("session_id"),
    ipPrefix: varchar("ip_prefix", { length: 64 }),
    detail: varchar("detail", { length: 255 }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_auth_audit_user_id").on(table.userId),
    index("idx_crm_auth_audit_event_at").on(table.createdAt),
  ],
);

/**
 * B1B: Persistent login rate limiting (hashed key avoids storing attempted emails).
 */
export const crmAuthRateLimits = mysqlTable(
  "crm_auth_rate_limits",
  {
    limitKey: char("limit_key", { length: 64 }).primaryKey(),
    attemptCount: int("attempt_count").notNull().default(0),
    windowStartedAt: utcDateTime("window_started_at").notNull(),
    blockedUntil: utcDateTime("blocked_until"),
    updatedAt: utcDateTime("updated_at").notNull(),
  },
  (table) => [index("idx_crm_auth_rate_limits_updated_at").on(table.updatedAt)],
);

export const b1aFoundationSchema = {
  crmSchemaMeta,
} as const;

export const authSchema = {
  crmSchemaMeta,
  crmUsers,
  crmSessions,
  crmAuthAudit,
  crmAuthRateLimits,
} as const;
