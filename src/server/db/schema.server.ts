import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { auditTimestamps, versionCol } from "./conventions.server";

/**
 * Foundation metadata table validated in Checkpoint B1A.
 * CRM domain tables (sessions, leads, deals, payments, projects, etc.)
 * are intentionally deferred to Checkpoints B1B and B2.
 */
export const crmSchemaMeta = mysqlTable("_crm_schema_meta", {
  metaKey: varchar("meta_key", { length: 64 }).primaryKey(),
  metaValue: varchar("meta_value", { length: 255 }).notNull(),
  version: versionCol("version"),
  ...auditTimestamps(),
});

export const b1aFoundationSchema = {
  crmSchemaMeta,
} as const;
