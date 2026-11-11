import {
  boolean,
  char,
  index,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  auditTimestamps,
  crmId,
  inrDecimal,
  istDateChar,
  utcDateTime,
  versionCol,
} from "./conventions.server";

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

/**
 * B2A: Core Leads table mirroring src/lib/crm/types.ts Lead + BinEntry lifecycle.
 * Legacy browser IDs are preserved in `legacy_id` for future B4 Data Vault migration.
 */
export const crmLeads = mysqlTable(
  "crm_leads",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    phone: varchar("phone", { length: 32 }).notNull(),
    phoneKey: varchar("phone_key", { length: 20 }).notNull(),
    email: varchar("email", { length: 160 }),
    emailNormalized: varchar("email_normalized", { length: 160 }),
    company: varchar("company", { length: 160 }),
    requirement: text("requirement"),
    source: varchar("source", { length: 32 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    priority: varchar("priority", { length: 16 }).notNull(),
    aiScore: int("ai_score"),
    quotedAmount: inrDecimal("quoted_amount"),
    budget: inrDecimal("budget"),
    lastContactAt: utcDateTime("last_contact_at"),
    nextFollowUpAt: utcDateTime("next_follow_up_at"),
    notes: text("notes"),
    pinned: boolean("pinned").notNull().default(false),
    quickStatus: varchar("quick_status", { length: 32 }),
    lostReason: varchar("lost_reason", { length: 500 }),
    lifecycleStatus: varchar("lifecycle_status", { length: 16 }).notNull().default("active"),
    archivedAt: utcDateTime("archived_at"),
    archiveReason: varchar("archive_reason", { length: 500 }),
    createdByUserId: crmId("created_by_user_id")
      .notNull()
      .references(() => crmUsers.id),
    updatedByUserId: crmId("updated_by_user_id")
      .notNull()
      .references(() => crmUsers.id),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_leads_owner_legacy").on(table.ownerUserId, table.legacyId),
    index("idx_crm_leads_owner_lifecycle_phone").on(
      table.ownerUserId,
      table.lifecycleStatus,
      table.phoneKey,
    ),
    index("idx_crm_leads_owner_lifecycle_email").on(
      table.ownerUserId,
      table.lifecycleStatus,
      table.emailNormalized,
    ),
    index("idx_crm_leads_owner_lifecycle_status").on(
      table.ownerUserId,
      table.lifecycleStatus,
      table.status,
    ),
    index("idx_crm_leads_owner_next_followup").on(
      table.ownerUserId,
      table.lifecycleStatus,
      table.nextFollowUpAt,
    ),
    index("idx_crm_leads_owner_created").on(table.ownerUserId, table.createdAt),
    index("idx_crm_leads_owner_updated").on(table.ownerUserId, table.updatedAt),
  ],
);

/**
 * B2A: Append-only Lead Activity & Timeline history.
 * `actor_user_id` is always derived from verified server auth context.
 */
export const crmLeadActivities = mysqlTable(
  "crm_lead_activities",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id),
    type: varchar("type", { length: 24 }).notNull(),
    text: text("text").notNull(),
    outcome: varchar("outcome", { length: 48 }),
    opId: varchar("op_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    occurredAt: utcDateTime("occurred_at").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_lead_activities_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_lead_activities_owner_lead_idem").on(
      table.ownerUserId,
      table.leadId,
      table.idempotencyKey,
    ),
    index("idx_crm_lead_activities_lead_occurred").on(table.leadId, table.occurredAt),
    index("idx_crm_lead_activities_owner_occurred").on(table.ownerUserId, table.occurredAt),
  ],
);

/**
 * B2A: Lead Follow-ups stored in UTC (`due_at`) with indexed Asia/Kolkata business date/time.
 * `active_lead_lock` holds `lead_id` only while pending (`NULL` once completed or cancelled)
 * so MySQL/MariaDB enforces at most one active pending follow-up per lead atomically.
 */
export const crmFollowUps = mysqlTable(
  "crm_follow_ups",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    activeLeadLock: crmId("active_lead_lock"),
    type: varchar("type", { length: 24 }).notNull(),
    dueAt: utcDateTime("due_at").notNull(),
    dueIstDate: istDateChar("due_ist_date").notNull(),
    dueIstTime: char("due_ist_time", { length: 5 }).notNull(),
    note: varchar("note", { length: 1000 }),
    completedAt: utcDateTime("completed_at"),
    cancelledAt: utcDateTime("cancelled_at"),
    cancelReason: varchar("cancel_reason", { length: 255 }),
    replacedById: crmId("replaced_by_id"),
    opId: varchar("op_id", { length: 128 }),
    createdByUserId: crmId("created_by_user_id")
      .notNull()
      .references(() => crmUsers.id),
    updatedByUserId: crmId("updated_by_user_id")
      .notNull()
      .references(() => crmUsers.id),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_follow_ups_active_lead").on(table.activeLeadLock),
    uniqueIndex("uq_crm_follow_ups_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_follow_ups_owner_op").on(table.ownerUserId, table.opId),
    index("idx_crm_follow_ups_lead_due").on(table.leadId, table.dueAt),
    index("idx_crm_follow_ups_owner_due").on(table.ownerUserId, table.dueAt),
    index("idx_crm_follow_ups_owner_ist_date").on(table.ownerUserId, table.dueIstDate),
  ],
);

/**
 * B2B3: Explicit user-recorded Lead call logs persisted atomically alongside `crm_lead_activities`
 * and honest `crm_leads` stage / `quick_status` / `last_contact_at` synchronization.
 */
export const crmCallLogs = mysqlTable(
  "crm_call_logs",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id),
    outcome: varchar("outcome", { length: 48 }).notNull(),
    connected: boolean("connected").notNull(),
    recordingSource: varchar("recording_source", { length: 24 }).notNull().default("user_recorded"),
    notes: text("notes"),
    dialSource: varchar("dial_source", { length: 64 }).notNull(),
    stageBefore: varchar("stage_before", { length: 24 }).notNull(),
    stageAfter: varchar("stage_after", { length: 24 }).notNull(),
    quickStatusBefore: varchar("quick_status_before", { length: 32 }),
    quickStatusAfter: varchar("quick_status_after", { length: 32 }),
    leadActivityId: crmId("lead_activity_id").notNull(),
    opId: varchar("op_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    occurredAt: utcDateTime("occurred_at").notNull(),
    occurredIstDate: istDateChar("occurred_ist_date").notNull(),
    occurredIstTime: char("occurred_ist_time", { length: 5 }).notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_call_logs_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_call_logs_owner_op").on(table.ownerUserId, table.opId),
    uniqueIndex("uq_crm_call_logs_owner_idem").on(
      table.ownerUserId,
      table.leadId,
      table.idempotencyKey,
    ),
    index("idx_crm_call_logs_lead_occurred").on(table.leadId, table.occurredAt),
    index("idx_crm_call_logs_owner_occurred").on(table.ownerUserId, table.occurredAt),
    index("idx_crm_call_logs_owner_ist_date").on(table.ownerUserId, table.occurredIstDate),
    index("idx_crm_call_logs_activity").on(table.leadActivityId),
  ],
);

/**
 * B2B4: Explicit owner-confirmed outgoing WhatsApp message logs persisted atomically
 * alongside `crm_lead_activities` (`type = 'whatsapp'`) and `crm_leads` version tracking.
 * Never claims delivery or two-way client reply (`confirmation_status = 'owner_confirmed_sent'`).
 */
export const crmWhatsAppLogs = mysqlTable(
  "crm_whatsapp_logs",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id),
    purpose: varchar("purpose", { length: 24 }).notNull(),
    templateId: varchar("template_id", { length: 64 }),
    templateName: varchar("template_name", { length: 120 }),
    recipientPhone: varchar("recipient_phone", { length: 20 }).notNull(),
    messageText: text("message_text").notNull(),
    confirmationStatus: varchar("confirmation_status", { length: 32 })
      .notNull()
      .default("owner_confirmed_sent"),
    composerSource: varchar("composer_source", { length: 64 }).notNull(),
    leadActivityId: crmId("lead_activity_id").notNull(),
    opId: varchar("op_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    confirmedAt: utcDateTime("confirmed_at").notNull(),
    confirmedIstDate: istDateChar("confirmed_ist_date").notNull(),
    confirmedIstTime: char("confirmed_ist_time", { length: 5 }).notNull(),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_wa_logs_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_wa_logs_owner_op").on(table.ownerUserId, table.opId),
    uniqueIndex("uq_crm_wa_logs_owner_idem").on(
      table.ownerUserId,
      table.leadId,
      table.idempotencyKey,
    ),
    index("idx_crm_wa_logs_lead_confirmed").on(table.leadId, table.confirmedAt),
    index("idx_crm_wa_logs_owner_confirmed").on(table.ownerUserId, table.confirmedAt),
    index("idx_crm_wa_logs_owner_ist_date").on(table.ownerUserId, table.confirmedIstDate),
    index("idx_crm_wa_logs_activity").on(table.leadActivityId),
  ],
);

/**
 * B2A: Supporting tag definitions & Lead tag mappings (mirrors src/lib/crm/customize.ts TagDef).
 */
export const crmTagDefs = mysqlTable(
  "crm_tag_defs",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 48 }).notNull(),
    description: varchar("description", { length: 255 }),
    color: varchar("color", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    scope: varchar("scope", { length: 16 }).notNull().default("lead"),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_tag_defs_owner_legacy").on(table.ownerUserId, table.legacyId),
    index("idx_crm_tag_defs_owner_status").on(table.ownerUserId, table.status),
  ],
);

export const crmLeadTags = mysqlTable(
  "crm_lead_tags",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    tagId: crmId("tag_id")
      .notNull()
      .references(() => crmTagDefs.id, { onDelete: "cascade" }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_lead_tags_lead_tag").on(table.leadId, table.tagId),
    index("idx_crm_lead_tags_owner_tag").on(table.ownerUserId, table.tagId),
  ],
);

/**
 * B2A: Supporting custom field definitions & per-Lead values (mirrors src/lib/crm/customize.ts).
 */
export const crmCustomFields = mysqlTable(
  "crm_custom_fields",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    entity: varchar("entity", { length: 16 }).notNull().default("lead"),
    label: varchar("label", { length: 80 }).notNull(),
    fieldType: varchar("field_type", { length: 24 }).notNull(),
    description: varchar("description", { length: 255 }),
    required: boolean("required").notNull().default(false),
    defaultValueJson: text("default_value_json"),
    optionsJson: text("options_json").notNull(),
    sortOrder: int("sort_order").notNull().default(0),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    highlight: boolean("highlight").notNull().default(false),
    visibility: varchar("visibility", { length: 16 }).notNull().default("team"),
    editable: varchar("editable", { length: 16 }).notNull().default("team"),
    currency: varchar("currency", { length: 8 }),
    historyJson: text("history_json").notNull(),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_custom_fields_owner_legacy").on(table.ownerUserId, table.legacyId),
    index("idx_crm_custom_fields_owner_entity").on(table.ownerUserId, table.entity, table.status),
  ],
);

export const crmLeadFieldValues = mysqlTable(
  "crm_lead_field_values",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "restrict" }),
    fieldId: crmId("field_id")
      .notNull()
      .references(() => crmCustomFields.id, { onDelete: "cascade" }),
    valueJson: text("value_json").notNull(),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_lead_field_values_lead_field").on(table.leadId, table.fieldId),
    index("idx_crm_lead_field_values_owner_field").on(table.ownerUserId, table.fieldId),
  ],
);

/**
 * B8A: Saved Lead Views & Filters (mirrors src/lib/crm/customize.ts SavedView).
 */
export const crmSavedViews = mysqlTable(
  "crm_saved_views",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 80 }).notNull(),
    visibility: varchar("visibility", { length: 24 }).notNull().default("company"),
    filterJson: text("filter_json").notNull(),
    sort: varchar("sort", { length: 24 }).notNull().default("recent"),
    columnsJson: text("columns_json"),
    archived: boolean("archived").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    isPinned: boolean("is_pinned").notNull().default(false),
    schemaVersion: int("schema_version").notNull().default(1),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_saved_views_owner_legacy").on(table.ownerUserId, table.legacyId),
    index("idx_crm_saved_views_owner_status").on(table.ownerUserId, table.archived),
  ],
);

/**
 * B2A: Transactional request idempotency table preventing duplicate writes across retries.
 */
export const crmIdempotencyKeys = mysqlTable(
  "crm_idempotency_keys",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 128 }).notNull(),
    idemKey: varchar("idem_key", { length: 128 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    resourceId: crmId("resource_id"),
    responseStatus: int("response_status").notNull(),
    responseBodyJson: text("response_body_json").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
    expiresAt: utcDateTime("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_idempotency_owner_scope_key").on(
      table.ownerUserId,
      table.scope,
      table.idemKey,
    ),
    index("idx_crm_idempotency_expires_at").on(table.expiresAt),
  ],
);

/**
 * B3A: Booked Deals ledger (`crm` Lead-linked clients or independent `other` clients).
 * Monetary amounts (`quoted_amount`, `final_amount`) use exact `DECIMAL(15, 2)` strings;
 * authoritative collected/outstanding/overdue balances are computed server-side in integer paise.
 * Foreign keys use `ON DELETE RESTRICT` so financial history can never cascade-disappear.
 */
export const crmDeals = mysqlTable(
  "crm_deals",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id").references(() => crmLeads.id, { onDelete: "restrict" }),
    clientType: varchar("client_type", { length: 16 }).notNull(),
    clientName: varchar("client_name", { length: 160 }).notNull(),
    company: varchar("company", { length: 160 }),
    phone: varchar("phone", { length: 32 }),
    name: varchar("name", { length: 160 }).notNull(),
    quotedAmount: inrDecimal("quoted_amount").notNull(),
    finalAmount: inrDecimal("final_amount").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    dueDate: istDateChar("due_date"),
    wonAt: utcDateTime("won_at"),
    wonIstDate: istDateChar("won_ist_date"),
    wonDateVerifiedAt: utcDateTime("won_date_verified_at"),
    wonDateVerifiedByUserId: crmId("won_date_verified_by_user_id").references(() => crmUsers.id, {
      onDelete: "restrict",
    }),
    cancelledAt: utcDateTime("cancelled_at"),
    cancelledIstDate: istDateChar("cancelled_ist_date"),
    cancelledByUserId: crmId("cancelled_by_user_id").references(() => crmUsers.id, {
      onDelete: "restrict",
    }),
    cancelReason: varchar("cancel_reason", { length: 500 }),
    notes: text("notes"),
    opId: varchar("op_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    createdByUserId: crmId("created_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    updatedByUserId: crmId("updated_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_deals_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_deals_owner_op").on(table.ownerUserId, table.opId),
    uniqueIndex("uq_crm_deals_owner_idem").on(table.ownerUserId, table.idempotencyKey),
    index("idx_crm_deals_owner_status_due").on(table.ownerUserId, table.status, table.dueDate),
    index("idx_crm_deals_owner_lead").on(table.ownerUserId, table.leadId),
    index("idx_crm_deals_owner_won_ist").on(table.ownerUserId, table.wonIstDate),
    index("idx_crm_deals_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B3A: Structured Deal payment-schedule milestones (`src/lib/crm/types.ts` `Milestone`).
 */
export const crmDealMilestones = mysqlTable(
  "crm_deal_milestones",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    dealId: crmId("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "restrict" }),
    label: varchar("label", { length: 160 }).notNull(),
    amount: inrDecimal("amount").notNull(),
    dueDate: istDateChar("due_date").notNull(),
    sortOrder: int("sort_order").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_deal_milestones_owner_legacy").on(table.ownerUserId, table.legacyId),
    index("idx_crm_deal_milestones_deal_order").on(table.dealId, table.sortOrder),
    index("idx_crm_deal_milestones_owner_due").on(table.ownerUserId, table.dueDate),
  ],
);

/**
 * B3A: Immutable-amount Payment ledger (`status = 'posted' | 'voided'`).
 * Voided payments remain in `crm_payments` with their original `amount` intact, explicit
 * `void_reason`, `voided_at`, and `voided_by_user_id`, while being excluded from collected totals.
 * Stable `id` + `legacy_id` support 1-to-1 private payment-proof storage in Checkpoint B3B.
 */
export const crmPayments = mysqlTable(
  "crm_payments",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    dealId: crmId("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "restrict" }),
    amount: inrDecimal("amount").notNull(),
    paymentIstDate: istDateChar("payment_ist_date").notNull(),
    method: varchar("method", { length: 32 }).notNull(),
    paymentType: varchar("payment_type", { length: 24 }).notNull(),
    reference: varchar("reference", { length: 160 }),
    notes: text("notes"),
    status: varchar("status", { length: 16 }).notNull().default("posted"),
    voided: boolean("voided").notNull().default(false),
    voidedAt: utcDateTime("voided_at"),
    voidedIstDate: istDateChar("voided_ist_date"),
    voidedByUserId: crmId("voided_by_user_id").references(() => crmUsers.id, {
      onDelete: "restrict",
    }),
    voidReason: varchar("void_reason", { length: 500 }),
    opId: varchar("op_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    recordedByUserId: crmId("recorded_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    updatedByUserId: crmId("updated_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_payments_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_payments_owner_op").on(table.ownerUserId, table.opId),
    uniqueIndex("uq_crm_payments_owner_deal_idem").on(
      table.ownerUserId,
      table.dealId,
      table.idempotencyKey,
    ),
    index("idx_crm_payments_deal_voided_date").on(table.dealId, table.voided, table.paymentIstDate),
    index("idx_crm_payments_owner_ist_date").on(table.ownerUserId, table.paymentIstDate),
    index("idx_crm_payments_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B3A: Append-only Financial Audit Ledger (`crm_finance_events`).
 * Captures every Deal creation/update/status-change/cancellation/won-date-verification and
 * Payment recording/voiding with server-derived `actor_user_id` and before/after snapshots.
 */
export const crmFinanceEvents = mysqlTable(
  "crm_finance_events",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    dealId: crmId("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "restrict" }),
    paymentId: crmId("payment_id").references(() => crmPayments.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id").references(() => crmLeads.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    reason: varchar("reason", { length: 500 }),
    amountSnapshot: inrDecimal("amount_snapshot"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    leadActivityId: crmId("lead_activity_id"),
    opId: varchar("op_id", { length: 128 }),
    occurredAt: utcDateTime("occurred_at").notNull(),
    occurredIstDate: istDateChar("occurred_ist_date").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_finance_events_deal_occurred").on(table.dealId, table.occurredAt),
    index("idx_crm_finance_events_payment_occurred").on(table.paymentId, table.occurredAt),
    index("idx_crm_finance_events_owner_occurred").on(table.ownerUserId, table.occurredAt),
    index("idx_crm_finance_events_owner_ist_date").on(table.ownerUserId, table.occurredIstDate),
  ],
);

/**
 * Dedicated payment-proof attachment metadata (Checkpoint B3B).
 * Supports JPEG, PNG, WebP, and PDF up to 10 MiB.
 * Physical files are stored strictly outside public web roots with private streaming.
 * Exactly one active proof is allowed per payment via `active_payment_lock`.
 * Historical replaced/removed records and files remain auditable (immutable evidence).
 */
export const crmPaymentProofs = mysqlTable(
  "crm_payment_proofs",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    paymentId: crmId("payment_id")
      .notNull()
      .references(() => crmPayments.id, { onDelete: "restrict" }),
    dealId: crmId("deal_id")
      .notNull()
      .references(() => crmDeals.id, { onDelete: "restrict" }),
    legacyAttachmentId: varchar("legacy_attachment_id", { length: 128 }),
    originalFileName: varchar("original_file_name", { length: 255 }).notNull(),
    fileExtension: varchar("file_extension", { length: 16 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }).notNull(),
    fileSize: int("file_size").notNull(),
    sha256Hash: char("sha256_hash", { length: 64 }).notNull(),
    storageDriver: varchar("storage_driver", { length: 32 }).notNull().default("local-fs"),
    storageKey: varchar("storage_key", { length: 255 }).notNull(),
    storageStatus: varchar("storage_status", { length: 24 }).notNull().default("verified"),
    storageProviderId: varchar("storage_provider_id", { length: 64 }),
    verifiedAt: utcDateTime("verified_at"),
    verificationError: varchar("verification_error", { length: 255 }),
    lifecycleStatus: varchar("lifecycle_status", { length: 24 }).notNull().default("active"),
    activePaymentLock: varchar("active_payment_lock", { length: 64 }),
    replacedByProofId: crmId("replaced_by_proof_id").references(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (): any => crmPaymentProofs.id,
      { onDelete: "restrict" },
    ),
    replacementReason: text("replacement_reason"),
    removalReason: text("removal_reason"),
    uploadedByUserId: crmId("uploaded_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    removedByUserId: crmId("removed_by_user_id").references(() => crmUsers.id, {
      onDelete: "restrict",
    }),
    version: int("version").notNull().default(1),
    uploadedAt: utcDateTime("uploaded_at").notNull(),
    removedAt: utcDateTime("removed_at"),
    createdAt: utcDateTime("created_at").notNull(),
    updatedAt: utcDateTime("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_payment_proofs_active_pay").on(table.ownerUserId, table.activePaymentLock),
    index("idx_crm_payment_proofs_owner_payment").on(table.ownerUserId, table.paymentId),
    index("idx_crm_payment_proofs_owner_deal").on(table.ownerUserId, table.dealId),
    index("idx_crm_payment_proofs_sha256").on(table.sha256Hash),
    index("idx_crm_payment_proofs_storage_key").on(table.storageKey),
    index("idx_crm_payment_proofs_storage_status").on(table.ownerUserId, table.storageStatus),
  ],
);

/**
 * B4A: Sales Studio Quotation Templates (reusable packages / offers).
 */
export const crmQuotationTemplates = mysqlTable(
  "crm_quotation_templates",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    priceType: varchar("price_type", { length: 32 }).notNull().default("fixed"),
    priceAmount: inrDecimal("price_amount"),
    priceLabel: varchar("price_label", { length: 128 }),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    messageBody: text("message_body").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),
    version: versionCol("version"),
    archivedAt: utcDateTime("archived_at"),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_qt_owner_active").on(table.ownerUserId, table.isActive),
    index("idx_crm_qt_owner_order").on(table.ownerUserId, table.sortOrder),
    index("idx_crm_qt_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B4A: Client Quotations ledger (supports both formal line-item proposals and confirmed WhatsApp quotation shares).
 * Financial amounts use DECIMAL(15, 2) strings with exact integer paise calculations.
 */
export const crmQuotations = mysqlTable(
  "crm_quotations",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    dealId: crmId("deal_id").references(() => crmDeals.id, { onDelete: "set null" }),
    templateId: crmId("template_id").references(() => crmQuotationTemplates.id, {
      onDelete: "set null",
    }),
    legacyId: varchar("legacy_id", { length: 64 }),
    quotationNumber: varchar("quotation_number", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    clientName: varchar("client_name", { length: 160 }).notNull(),
    clientCompany: varchar("client_company", { length: 160 }),
    currency: varchar("currency", { length: 8 }).notNull().default("INR"),
    subtotal: inrDecimal("subtotal").notNull().default("0.00"),
    discountType: varchar("discount_type", { length: 16 }).notNull().default("none"),
    discountValue: inrDecimal("discount_value").notNull().default("0.00"),
    discountAmount: inrDecimal("discount_amount").notNull().default("0.00"),
    taxableAmount: inrDecimal("taxable_amount").notNull().default("0.00"),
    gstEnabled: boolean("gst_enabled").notNull().default(false),
    gstRate: inrDecimal("gst_rate").notNull().default("0.00"),
    gstAmount: inrDecimal("gst_amount").notNull().default("0.00"),
    totalAmount: inrDecimal("total_amount").notNull().default("0.00"),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    issueIstDate: istDateChar("issue_ist_date").notNull(),
    validUntilIstDate: istDateChar("valid_until_ist_date"),
    paymentTerms: text("payment_terms"),
    notes: text("notes"),
    messageBody: text("message_body"),
    userConfirmedSent: boolean("user_confirmed_sent").notNull().default(false),
    sentAt: utcDateTime("sent_at"),
    acceptedAt: utcDateTime("accepted_at"),
    rejectedAt: utcDateTime("rejected_at"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    version: versionCol("version"),
    archivedAt: utcDateTime("archived_at"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_quotations_owner_number").on(table.ownerUserId, table.quotationNumber),
    uniqueIndex("uq_crm_quotations_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_quotations_owner_idem").on(table.ownerUserId, table.idempotencyKey),
    index("idx_crm_quotations_owner_lead").on(table.ownerUserId, table.leadId),
    index("idx_crm_quotations_owner_deal").on(table.ownerUserId, table.dealId),
    index("idx_crm_quotations_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_quotations_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B4A: Quotation line items for structured proposals / deliverables.
 */
export const crmQuotationItems = mysqlTable(
  "crm_quotation_items",
  {
    id: crmId("id").primaryKey(),
    quotationId: crmId("quotation_id")
      .notNull()
      .references(() => crmQuotations.id, { onDelete: "cascade" }),
    description: varchar("description", { length: 500 }).notNull(),
    quantity: inrDecimal("quantity").notNull().default("1.00"),
    unitPrice: inrDecimal("unit_price").notNull().default("0.00"),
    totalAmount: inrDecimal("total_amount").notNull().default("0.00"),
    sortOrder: int("sort_order").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [index("idx_crm_qi_quotation_order").on(table.quotationId, table.sortOrder)],
);

/**
 * B4A: Quotation payment schedule milestones.
 */
export const crmQuotationMilestones = mysqlTable(
  "crm_quotation_milestones",
  {
    id: crmId("id").primaryKey(),
    quotationId: crmId("quotation_id")
      .notNull()
      .references(() => crmQuotations.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 160 }).notNull(),
    percentage: inrDecimal("percentage").notNull().default("0.00"),
    amount: inrDecimal("amount").notNull().default("0.00"),
    dueDate: istDateChar("due_date"),
    sortOrder: int("sort_order").notNull().default(0),
    ...auditTimestamps(),
  },
  (table) => [index("idx_crm_qm_quotation_order").on(table.quotationId, table.sortOrder)],
);

/**
 * B4A: Immutable historical revisions for quotations.
 */
export const crmQuotationRevisions = mysqlTable(
  "crm_quotation_revisions",
  {
    id: crmId("id").primaryKey(),
    quotationId: crmId("quotation_id")
      .notNull()
      .references(() => crmQuotations.id, { onDelete: "cascade" }),
    revisionNumber: int("revision_number").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    changeSummary: varchar("change_summary", { length: 255 }),
    createdByUserId: crmId("created_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_qrev_quotation_number").on(table.quotationId, table.revisionNumber),
    index("idx_crm_qrev_quotation_created").on(table.quotationId, table.createdAt),
  ],
);

/**
 * B4A: Immutable audit trail for quotation lifecycle events.
 */
export const crmQuotationAuditEvents = mysqlTable(
  "crm_quotation_audit_events",
  {
    id: crmId("id").primaryKey(),
    quotationId: crmId("quotation_id")
      .notNull()
      .references(() => crmQuotations.id, { onDelete: "cascade" }),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    summary: varchar("summary", { length: 255 }).notNull(),
    detailsJson: text("details_json"),
    occurredIstDate: istDateChar("occurred_ist_date").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_qev_owner_quotation").on(table.ownerUserId, table.quotationId, table.createdAt),
    index("idx_crm_qev_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B5A: Reusable project package/process templates.
 */
export const crmProjectTemplates = mysqlTable(
  "crm_project_templates",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 160 }).notNull(),
    type: varchar("type", { length: 160 }).notNull(),
    builtIn: boolean("built_in").notNull().default(false),
    milestonesJson: text("milestones_json").notNull(),
    tasksJson: text("tasks_json").notNull(),
    requirementsJson: text("requirements_json").notNull(),
    qaJson: text("qa_json").notNull(),
    handoverJson: text("handover_json").notNull(),
    archived: boolean("archived").notNull().default(false),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_ptpl_owner").on(table.ownerUserId),
    index("idx_crm_ptpl_owner_archived").on(table.ownerUserId, table.archived),
  ],
);

/**
 * B5A: Projects table tracking physical delivery from won deals or direct creation.
 */
export const crmProjects = mysqlTable(
  "crm_projects",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    clientName: varchar("client_name", { length: 160 }).notNull(),
    company: varchar("company", { length: 160 }),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 160 }),
    leadId: crmId("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
    dealId: crmId("deal_id").references(() => crmDeals.id, { onDelete: "set null" }),
    templateId: crmId("template_id").references(() => crmProjectTemplates.id, { onDelete: "set null" }),
    legacyId: varchar("legacy_id", { length: 64 }),
    type: varchar("type", { length: 160 }).notNull(),
    scope: text("scope"),
    bookingDate: istDateChar("booking_date"),
    plannedStart: istDateChar("planned_start"),
    actualStart: istDateChar("actual_start"),
    targetDelivery: istDateChar("target_delivery"),
    status: varchar("status", { length: 32 }).notNull().default("accepted"),
    stage: varchar("stage", { length: 32 }).notNull().default("discovery"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    projectOwnerId: varchar("project_owner_id", { length: 64 }),
    memberIdsJson: text("member_ids_json"),
    dependenciesJson: text("dependencies_json"),
    requirementsJson: text("requirements_json"),
    qaJson: text("qa_json"),
    handoverJson: text("handover_json"),
    linksJson: text("links_json"),
    deliveryJson: text("delivery_json"),
    supportJson: text("support_json"),
    carriedJson: text("carried_json"),
    notes: text("notes"),
    reviewFlag: varchar("review_flag", { length: 255 }),
    attentionJson: text("attention_json"),
    archived: boolean("archived").notNull().default(false),
    archivedAt: utcDateTime("archived_at"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_projects_owner_idem").on(table.ownerUserId, table.idempotencyKey),
    uniqueIndex("uq_crm_projects_owner_legacy").on(table.ownerUserId, table.legacyId),
    index("idx_crm_projects_owner_lead").on(table.ownerUserId, table.leadId),
    index("idx_crm_projects_owner_deal").on(table.ownerUserId, table.dealId),
    index("idx_crm_projects_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_projects_owner_stage").on(table.ownerUserId, table.stage),
    index("idx_crm_projects_owner_archived").on(table.ownerUserId, table.archived),
    index("idx_crm_projects_owner_target").on(table.ownerUserId, table.targetDelivery),
    index("idx_crm_projects_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B5A: Project delivery milestones (delivery phases, distinct from payment milestones).
 */
export const crmProjectMilestones = mysqlTable(
  "crm_project_milestones",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    projectId: crmId("project_id")
      .notNull()
      .references(() => crmProjects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    dueDate: istDateChar("due_date"),
    sortOrder: int("sort_order").notNull().default(0),
    status: varchar("status", { length: 32 }).notNull().default("open"),
    completedAt: utcDateTime("completed_at"),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_pm_project_order").on(table.projectId, table.sortOrder),
    index("idx_crm_pm_owner_project").on(table.ownerUserId, table.projectId),
  ],
);

/**
 * B5A: Project tasks with assignees, due dates, ordering and optimistic locking.
 */
export const crmProjectTasks = mysqlTable(
  "crm_project_tasks",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    projectId: crmId("project_id")
      .notNull()
      .references(() => crmProjects.id, { onDelete: "cascade" }),
    milestoneId: crmId("milestone_id")
      .references(() => crmProjectMilestones.id, { onDelete: "set null" }),
    title: varchar("title", { length: 255 }).notNull(),
    notes: text("notes"),
    assigneeId: varchar("assignee_id", { length: 64 }),
    dueDate: istDateChar("due_date"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    status: varchar("status", { length: 16 }).notNull().default("open"),
    completedAt: utcDateTime("completed_at"),
    completedBy: varchar("completed_by", { length: 64 }),
    sortOrder: int("sort_order").notNull().default(0),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_pt_project_order").on(table.projectId, table.sortOrder),
    index("idx_crm_pt_project_milestone").on(table.projectId, table.milestoneId),
    index("idx_crm_pt_owner_project_status").on(table.ownerUserId, table.projectId, table.status),
    index("idx_crm_pt_owner_due").on(table.ownerUserId, table.dueDate),
    uniqueIndex("uq_crm_pt_owner_idem").on(table.ownerUserId, table.idempotencyKey),
  ],
);

/**
 * B5A: Project deliverables and client review tracking.
 */
export const crmProjectDeliverables = mysqlTable(
  "crm_project_deliverables",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    projectId: crmId("project_id")
      .notNull()
      .references(() => crmProjects.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    category: varchar("category", { length: 64 }).notNull().default("general"),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    dueDate: istDateChar("due_date"),
    deliveredAt: utcDateTime("delivered_at"),
    revisionCount: int("revision_count").notNull().default(0),
    latestRevisionNotes: text("latest_revision_notes"),
    clientFeedback: text("client_feedback"),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_pdel_owner_project").on(table.ownerUserId, table.projectId),
    index("idx_crm_pdel_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_pdel_project_created").on(table.projectId, table.createdAt),
  ],
);

/**
 * B5A: Historical deliverable revisions preserving feedback and version history.
 */
export const crmProjectDeliverableRevisions = mysqlTable(
  "crm_project_deliverable_revisions",
  {
    id: crmId("id").primaryKey(),
    deliverableId: crmId("deliverable_id")
      .notNull()
      .references(() => crmProjectDeliverables.id, { onDelete: "cascade" }),
    revisionNumber: int("revision_number").notNull(),
    title: varchar("title", { length: 255 }),
    summary: varchar("summary", { length: 255 }).notNull(),
    fileUrl: varchar("file_url", { length: 1024 }),
    notes: text("notes"),
    clientFeedback: text("client_feedback"),
    status: varchar("status", { length: 32 }).notNull().default("submitted"),
    createdByUserId: crmId("created_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_pdr_deliv_rev").on(table.deliverableId, table.revisionNumber),
    index("idx_crm_pdr_deliv_created").on(table.deliverableId, table.createdAt),
  ],
);

/**
 * B5A: Client support tickets / requests tied to projects with resolution history.
 */
export const crmClientSupportTickets = mysqlTable(
  "crm_client_support_tickets",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    projectId: crmId("project_id")
      .notNull()
      .references(() => crmProjects.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    assigneeId: varchar("assignee_id", { length: 64 }),
    dueDate: istDateChar("due_date"),
    status: varchar("status", { length: 32 }).notNull().default("open"),
    resolution: text("resolution"),
    resolvedAt: utcDateTime("resolved_at"),
    resolvedByUserId: crmId("resolved_by_user_id").references(() => crmUsers.id, { onDelete: "set null" }),
    coverage: varchar("coverage", { length: 32 }).notNull().default("undecided"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_cst_owner_project_status").on(table.ownerUserId, table.projectId, table.status),
    index("idx_crm_cst_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_cst_owner_priority").on(table.ownerUserId, table.priority),
    uniqueIndex("uq_crm_cst_owner_idem").on(table.ownerUserId, table.idempotencyKey),
  ],
);

/**
 * B5A: Append-only project activity and audit events.
 */
export const crmProjectAuditEvents = mysqlTable(
  "crm_project_audit_events",
  {
    id: crmId("id").primaryKey(),
    projectId: crmId("project_id")
      .notNull()
      .references(() => crmProjects.id, { onDelete: "cascade" }),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    summary: varchar("summary", { length: 255 }).notNull(),
    detailsJson: text("details_json"),
    occurredIstDate: istDateChar("occurred_ist_date").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_pae_owner_project").on(table.ownerUserId, table.projectId, table.createdAt),
    index("idx_crm_pae_owner_type").on(table.ownerUserId, table.eventType),
    index("idx_crm_pae_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B6A: Owner-scoped persistent business configuration and operational preferences.
 * Strictly separates business configuration from device-local UI prefs and auth credentials.
 */
export const crmOwnerSettings = mysqlTable(
  "crm_owner_settings",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    ownerDisplayName: varchar("owner_display_name", { length: 120 }),
    businessName: varchar("business_name", { length: 160 }),
    profileEmail: varchar("profile_email", { length: 191 }),
    businessPhone: varchar("business_phone", { length: 32 }),
    businessWebsite: varchar("business_website", { length: 255 }),
    businessAddress: text("business_address"),
    gstin: varchar("gstin", { length: 32 }),
    paymentInstructions: text("payment_instructions"),
    businessTimezone: varchar("business_timezone", { length: 64 })
      .notNull()
      .default("Asia/Kolkata"),
    currencyCode: varchar("currency_code", { length: 8 }).notNull().default("INR"),
    defaultLeadSort: varchar("default_lead_sort", { length: 24 }).notNull().default("recent"),
    notifyFollowUps: boolean("notify_follow_ups").notNull().default(true),
    notifyPayments: boolean("notify_payments").notNull().default(true),
    notifyDigest: boolean("notify_digest").notNull().default(false),
    notifyGoalAchieved: boolean("notify_goal_achieved").notNull().default(true),
    notifyTeamGoal: boolean("notify_team_goal").notNull().default(true),
    notifyMilestone: boolean("notify_milestone").notNull().default(false),
    notifyOverdue: boolean("notify_overdue").notNull().default(true),
    overdueThreshold: int("overdue_threshold").notNull().default(10),
    updatedByUserId: crmId("updated_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [uniqueIndex("uq_crm_os_owner").on(table.ownerUserId)],
);

/**
 * B6A: Append-only audit trail for material business configuration changes.
 */
export const crmSettingsAuditEvents = mysqlTable(
  "crm_settings_audit_events",
  {
    id: crmId("id").primaryKey(),
    settingsId: crmId("settings_id")
      .notNull()
      .references(() => crmOwnerSettings.id, { onDelete: "restrict" }),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    section: varchar("section", { length: 32 }).notNull(),
    eventType: varchar("event_type", { length: 48 }).notNull(),
    summary: varchar("summary", { length: 255 }).notNull(),
    changedFieldsJson: text("changed_fields_json").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    versionBefore: int("version_before").notNull(),
    versionAfter: int("version_after").notNull(),
    occurredIstDate: istDateChar("occurred_ist_date").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_sae_owner_created").on(table.ownerUserId, table.createdAt),
    index("idx_crm_sae_settings_created").on(table.settingsId, table.createdAt),
  ],
);

/**
 * B6A: Owner-scoped Sales Goals with explicit metric, scope, period, effective IST date,
 * exact count/INR target (nullable when explicitly unset), optimistic locking, and soft archive.
 */
export const crmSalesGoals = mysqlTable(
  "crm_sales_goals",
  {
    id: crmId("id").primaryKey(),
    legacyId: crmId("legacy_id"),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    metric: varchar("metric", { length: 48 }).notNull(),
    scope: varchar("scope", { length: 24 }).notNull().default("owner"),
    targetUnit: varchar("target_unit", { length: 16 }).notNull(),
    targetCount: int("target_count"),
    targetAmount: inrDecimal("target_amount"),
    period: varchar("period", { length: 24 }).notNull(),
    customFromIst: istDateChar("custom_from_ist"),
    customToIst: istDateChar("custom_to_ist"),
    effectiveFromIst: istDateChar("effective_from_ist").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    archivedAt: utcDateTime("archived_at"),
    archiveReason: varchar("archive_reason", { length: 255 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    createdByUserId: crmId("created_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    updatedByUserId: crmId("updated_by_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_sg_owner_legacy").on(table.ownerUserId, table.legacyId),
    uniqueIndex("uq_crm_sg_owner_idem").on(table.ownerUserId, table.idempotencyKey),
    index("idx_crm_sg_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_sg_owner_metric").on(table.ownerUserId, table.metric),
    index("idx_crm_sg_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B6A: Immutable append-only revision history for Sales Goals (`definitionOn` time-travel accuracy).
 */
export const crmSalesGoalRevisions = mysqlTable(
  "crm_sales_goal_revisions",
  {
    id: crmId("id").primaryKey(),
    goalId: crmId("goal_id")
      .notNull()
      .references(() => crmSalesGoals.id, { onDelete: "restrict" }),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    revisionNumber: int("revision_number").notNull(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    effectiveFromIst: istDateChar("effective_from_ist").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    changeSummary: varchar("change_summary", { length: 255 }).notNull(),
    occurredIstDate: istDateChar("occurred_ist_date").notNull(),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_sgr_goal_rev").on(table.goalId, table.revisionNumber),
    index("idx_crm_sgr_owner_goal_rev").on(table.ownerUserId, table.goalId, table.revisionNumber),
    index("idx_crm_sgr_owner_effective").on(
      table.ownerUserId,
      table.goalId,
      table.effectiveFromIst,
    ),
  ],
);

/**
 * B9A: Smart Lead Inbox intake review metadata (mirrors src/lib/crm/inbox.ts InboxMeta).
 */
export const crmLeadInboxItems = mysqlTable(
  "crm_lead_inbox_items",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadId: crmId("lead_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 24 }).notNull().default("needs_review"),
    reviewedAt: utcDateTime("reviewed_at"),
    flaggedAt: utcDateTime("flagged_at"),
    flagNote: varchar("flag_note", { length: 255 }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_lead_inbox_items_owner_lead").on(table.ownerUserId, table.leadId),
    index("idx_crm_lead_inbox_items_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_lead_inbox_items_owner_reviewed").on(table.ownerUserId, table.reviewedAt),
  ],
);

/**
 * B9A: Duplicate candidate pairs detected between leads (mirrors src/lib/crm/inbox.ts DupPair).
 */
export const crmDuplicateCandidates = mysqlTable(
  "crm_duplicate_candidates",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadAId: crmId("lead_a_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "cascade" }),
    leadBId: crmId("lead_b_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "cascade" }),
    pairKey: varchar("pair_key", { length: 130 }).notNull(),
    reasonsJson: varchar("reasons_json", { length: 255 }).notNull(),
    strength: varchar("strength", { length: 16 }).notNull().default("suggested"),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    pairSignature: varchar("pair_signature", { length: 255 }).notNull(),
    reopened: boolean("reopened").notNull().default(false),
    decisionKind: varchar("decision_kind", { length: 24 }),
    decisionNote: varchar("decision_note", { length: 255 }),
    decidedAt: utcDateTime("decided_at"),
    decidedByUserId: crmId("decided_by_user_id").references(() => crmUsers.id, { onDelete: "set null" }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_dup_candidates_owner_pair").on(table.ownerUserId, table.pairKey),
    index("idx_crm_dup_candidates_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_dup_candidates_owner_lead_a").on(table.ownerUserId, table.leadAId),
    index("idx_crm_dup_candidates_owner_lead_b").on(table.ownerUserId, table.leadBId),
  ],
);

/**
 * B9A: Audited Lead Relationships (mirrors src/lib/crm/inbox.ts LeadRelation).
 */
export const crmLeadRelationships = mysqlTable(
  "crm_lead_relationships",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    leadAId: crmId("lead_a_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "cascade" }),
    leadBId: crmId("lead_b_id")
      .notNull()
      .references(() => crmLeads.id, { onDelete: "cascade" }),
    pairKey: varchar("pair_key", { length: 130 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(), // "separate" | "related"
    signature: varchar("signature", { length: 255 }).notNull(),
    note: varchar("note", { length: 255 }),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_lead_rel_owner_pair").on(table.ownerUserId, table.pairKey),
    index("idx_crm_lead_rel_owner_kind").on(table.ownerUserId, table.kind),
    index("idx_crm_lead_rel_owner_lead_a").on(table.ownerUserId, table.leadAId),
    index("idx_crm_lead_rel_owner_lead_b").on(table.ownerUserId, table.leadBId),
  ],
);

/**
 * B9A: Append-only audit history of Smart Inbox and relationship actions.
 */
export const crmLeadRelationshipHistory = mysqlTable(
  "crm_lead_relationship_history",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    pairKey: varchar("pair_key", { length: 130 }),
    leadAId: crmId("lead_a_id"),
    leadBId: crmId("lead_b_id"),
    candidateId: crmId("candidate_id"),
    action: varchar("action", { length: 32 }).notNull(),
    kind: varchar("kind", { length: 24 }),
    previousKind: varchar("previous_kind", { length: 24 }),
    signature: varchar("signature", { length: 255 }),
    note: varchar("note", { length: 255 }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_inbox_audit_owner_pair").on(table.ownerUserId, table.pairKey),
    index("idx_crm_inbox_audit_owner_created").on(table.ownerUserId, table.createdAt),
    index("idx_crm_inbox_audit_owner_action").on(table.ownerUserId, table.action),
  ],
);

/**
 * B10A: Owner Automation Rules.
 * Stores trigger, condition, action, and setting definitions.
 * Strict invariant: `enabled` is purely a configuration flag; unattended background execution is deferred.
 */
export const crmAutomationRules = mysqlTable(
  "crm_automation_rules",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 255 }).notNull().default(""),
    templateId: varchar("template_id", { length: 64 }),
    subject: varchar("subject", { length: 24 }).notNull().default("lead"), // "lead" | "project"
    triggerType: varchar("trigger_type", { length: 48 }).notNull(),
    status: varchar("status", { length: 24 }).notNull().default("draft"), // "draft" | "enabled" | "paused" | "archived"
    pausedReason: varchar("paused_reason", { length: 255 }),
    conditionsJson: text("conditions_json").notNull(),
    actionsJson: text("actions_json").notNull(),
    settingsJson: text("settings_json").notNull(),
    lastEvaluatedAt: utcDateTime("last_evaluated_at"),
    lastTriggeredAt: utcDateTime("last_triggered_at"),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    index("idx_crm_auto_rules_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_auto_rules_owner_trigger").on(table.ownerUserId, table.triggerType),
    index("idx_crm_auto_rules_owner_subject").on(table.ownerUserId, table.subject),
  ],
);

/**
 * B10A: Immutable audit revisions of automation rules.
 * Never truncated after a fixed count; preserves complete history for every edit.
 */
export const crmAutomationRuleRevisions = mysqlTable(
  "crm_automation_rule_revisions",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    ruleId: crmId("rule_id")
      .notNull()
      .references(() => crmAutomationRules.id, { onDelete: "cascade" }),
    version: int("version").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    description: varchar("description", { length: 255 }).notNull().default(""),
    subject: varchar("subject", { length: 24 }).notNull(),
    triggerType: varchar("trigger_type", { length: 48 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    conditionsJson: text("conditions_json").notNull(),
    actionsJson: text("actions_json").notNull(),
    settingsJson: text("settings_json").notNull(),
    diffSummary: varchar("diff_summary", { length: 255 }),
    actorUserId: crmId("actor_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    index("idx_crm_auto_rev_owner_rule").on(table.ownerUserId, table.ruleId, table.version),
    index("idx_crm_auto_rev_owner_created").on(table.ownerUserId, table.createdAt),
  ],
);

/**
 * B10A/B10C: Automation runs, dry-run simulation, and live execution audit history.
 */
export const crmAutomationRuns = mysqlTable(
  "crm_automation_runs",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    ruleId: crmId("rule_id")
      .notNull()
      .references(() => crmAutomationRules.id, { onDelete: "cascade" }),
    executionKey: varchar("execution_key", { length: 128 }),
    ruleVersion: int("rule_version"),
    triggerType: varchar("trigger_type", { length: 48 }).notNull(),
    outcome: varchar("outcome", { length: 24 }).notNull(), // "evaluated" | "triggered" | "skipped" | "failed" | "simulated" | "disabled" | "succeeded"
    isSimulation: boolean("is_simulation").notNull().default(false),
    leadId: crmId("lead_id"),
    projectId: crmId("project_id"),
    matchedCount: int("matched_count").notNull().default(0),
    skippedCount: int("skipped_count").notNull().default(0),
    plannedActionsJson: text("planned_actions_json").notNull(),
    executedActionsJson: text("executed_actions_json").notNull(),
    executionError: varchar("execution_error", { length: 255 }),
    causationId: varchar("causation_id", { length: 128 }),
    depth: int("depth").notNull().default(0),
    actorUserId: crmId("actor_user_id").references(() => crmUsers.id, { onDelete: "set null" }),
    createdAt: utcDateTime("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_crm_auto_runs_owner_exec_key").on(table.ownerUserId, table.executionKey),
    index("idx_crm_auto_runs_owner_rule").on(table.ownerUserId, table.ruleId),
    index("idx_crm_auto_runs_owner_created").on(table.ownerUserId, table.createdAt),
    index("idx_crm_auto_runs_owner_sim").on(table.ownerUserId, table.isSimulation),
  ],
);

/**
 * B10A: Server-backed Internal Reminders generated by rules or manual creation.
 */
export const crmInternalReminders = mysqlTable(
  "crm_internal_reminders",
  {
    id: crmId("id").primaryKey(),
    ownerUserId: crmId("owner_user_id")
      .notNull()
      .references(() => crmUsers.id, { onDelete: "restrict" }),
    reminderKey: varchar("reminder_key", { length: 255 }).notNull(),
    ruleId: crmId("rule_id").references(() => crmAutomationRules.id, { onDelete: "set null" }),
    ruleName: varchar("rule_name", { length: 128 }),
    leadId: crmId("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
    projectId: crmId("project_id").references(() => crmProjects.id, { onDelete: "cascade" }),
    taskId: crmId("task_id"),
    employeeId: varchar("employee_id", { length: 64 }),
    reason: varchar("reason", { length: 255 }).notNull(),
    dueAt: utcDateTime("due_at").notNull(),
    importance: varchar("importance", { length: 16 }).notNull().default("normal"), // "normal" | "high"
    status: varchar("status", { length: 24 }).notNull().default("open"), // "open" | "done" | "dismissed" | "resolved"
    flag: boolean("flag").notNull().default(false),
    ownerReview: boolean("owner_review").notNull().default(false),
    escalated: boolean("escalated").notNull().default(false),
    followUpId: crmId("follow_up_id").references(() => crmFollowUps.id, { onDelete: "set null" }),
    resolveWhen: varchar("resolve_when", { length: 24 }).notNull().default("never"),
    origin: varchar("origin", { length: 24 }).notNull().default("automation"), // "automation" | "manual"
    historyJson: text("history_json"),
    closedAt: utcDateTime("closed_at"),
    version: versionCol("version"),
    ...auditTimestamps(),
  },
  (table) => [
    uniqueIndex("uq_crm_reminders_owner_key").on(table.ownerUserId, table.reminderKey),
    index("idx_crm_reminders_owner_status").on(table.ownerUserId, table.status),
    index("idx_crm_reminders_owner_due").on(table.ownerUserId, table.dueAt),
    index("idx_crm_reminders_owner_lead").on(table.ownerUserId, table.leadId),
  ],
);

export const crmAutomationSchema = {
  crmAutomationRules,
  crmAutomationRuleRevisions,
  crmAutomationRuns,
  crmInternalReminders,
} as const;

export const crmInboxSchema = {
  crmLeadInboxItems,
  crmDuplicateCandidates,
  crmLeadRelationships,
  crmLeadRelationshipHistory,
} as const;

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

export const crmFinanceSchema = {
  crmDeals,
  crmDealMilestones,
  crmPayments,
  crmFinanceEvents,
  crmPaymentProofs,
} as const;

export const crmQuotationSchema = {
  crmQuotationTemplates,
  crmQuotations,
  crmQuotationItems,
  crmQuotationMilestones,
  crmQuotationRevisions,
  crmQuotationAuditEvents,
} as const;

export const crmProjectsSchema = {
  crmProjectTemplates,
  crmProjects,
  crmProjectMilestones,
  crmProjectTasks,
  crmProjectDeliverables,
  crmProjectDeliverableRevisions,
  crmClientSupportTickets,
  crmProjectAuditEvents,
} as const;

export const crmSettingsGoalsSchema = {
  crmOwnerSettings,
  crmSettingsAuditEvents,
  crmSalesGoals,
  crmSalesGoalRevisions,
} as const;

export const crmCoreSchema = {
  crmLeads,
  crmLeadActivities,
  crmFollowUps,
  crmCallLogs,
  crmWhatsAppLogs,
  crmTagDefs,
  crmLeadTags,
  crmCustomFields,
  crmLeadFieldValues,
  crmSavedViews,
  crmIdempotencyKeys,
  ...crmFinanceSchema,
  ...crmQuotationSchema,
  ...crmProjectsSchema,
  ...crmSettingsGoalsSchema,
  ...crmInboxSchema,
  ...crmAutomationSchema,
} as const;

export const appSchema = {
  ...authSchema,
  ...crmCoreSchema,
} as const;
