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
  crmIdempotencyKeys,
  ...crmFinanceSchema,
} as const;

export const appSchema = {
  ...authSchema,
  ...crmCoreSchema,
} as const;
