import { char, customType, datetime, decimal, int, varchar } from "drizzle-orm/mysql-core";

export const MYSQL_COMPATIBILITY_PROFILE = {
  targetEngines: ["MySQL 8.0+", "MariaDB 10.6+"] as const,
  charset: "utf8mb4",
  collation: "utf8mb4_unicode_ci",
  storageEngine: "InnoDB",
  businessTimezone: "Asia/Kolkata",
  storageTimezone: "UTC",
} as const;

/** Standard primary/foreign CRM entity identifier (matches browser-generated IDs + UUIDs). */
export function crmId(name: string) {
  return varchar(name, { length: 64 });
}

/** UTC timestamp with millisecond precision stored as ISO-like string without TIMESTAMP 2038 limits. */
export function utcDateTime(name: string) {
  return datetime(name, { mode: "string", fsp: 3 });
}

/** Business date-only value (`YYYY-MM-DD` in Asia/Kolkata, matching dates.ts). */
export function istDateChar(name: string) {
  return char(name, { length: 10 });
}

/** Exact INR currency column (`DECIMAL(15, 2)` read as string with `decimalNumbers: false`). */
export function inrDecimal(name: string) {
  return decimal(name, { precision: 15, scale: 2 });
}

/** Optimistic concurrency column matching existing `version` semantics (`projects.ts`, `crossTab.ts`). */
export function versionCol(name = "version") {
  return int(name).notNull().default(1);
}

/** Binary LONGBLOB column for optional MariaDB-backed payment proof storage. */
export function longBlob(name: string) {
  return customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
    dataType() {
      return "longblob";
    },
    toDriver(value: Buffer) {
      return value;
    },
    fromDriver(value: Buffer | Uint8Array) {
      return Buffer.isBuffer(value) ? value : Buffer.from(value);
    },
  })(name);
}

/** Standard audit timestamps required on durable CRM tables. */
export function auditTimestamps() {
  return {
    createdAt: utcDateTime("created_at").notNull(),
    updatedAt: utcDateTime("updated_at").notNull(),
  };
}
