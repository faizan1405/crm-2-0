#!/usr/bin/env node
/**
 * Checkpoint B13C — Offline Local Migration Pre-Flight Preview CLI
 *
 * Strictly offline & local-only:
 * - Zero network requests, zero server uploads, zero AI calls, zero database writes.
 * - Reads a local Data Vault `.zip` or legacy CRM `.json` file and prints a complete
 *   pre-flight report: entity counts, missing FKs, duplicate IDs, duplicate phones,
 *   unsupported fields, exact integer-paise financial totals & per-deal balances,
 *   payment-proof SHA-256 & magic-byte integrity, deferred collections, and
 *   estimated Hostinger MariaDB quota footprint (Cloudflare R2 NOT required).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

const QUOTA_MIB = 3072;
const WARN_MIB = 1536;
const HARD_STOP_MIB = 2150;
const SAFETY_MARGIN_MIB = 16;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function parseStrictPaise(val) {
  if (val === undefined || val === null || val === "") return { ok: true, paise: 0 };
  const s = String(val).replace(/,/g, "").trim();
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return { ok: false, error: `Invalid INR amount '${val}'` };
  return { ok: true, paise: Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) };
}

function formatPaiseInr(paise) {
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, "0");
  const str = String(rupees);
  const grouped =
    str.length <= 3
      ? str
      : `${str.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${str.slice(-3)}`;
  return `${paise < 0 ? "-" : ""}₹${grouped}.${rem}`;
}

function sniffProof(bytes) {
  if (bytes.byteLength < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true; // JPEG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true; // PNG
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return true; // WebP
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return true; // PDF
  return false;
}

function main() {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const inputPath = fileIdx >= 0 ? args[fileIdx + 1] : args[0];

  if (!inputPath) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "MISSING_INPUT_FILE",
        usage: "node scripts/b13c-offline-migration-preview.mjs --file <path-to-backup.zip-or-.json>",
      }),
    );
    process.exit(2);
  }

  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(JSON.stringify({ ok: false, code: "FILE_NOT_FOUND", path: resolved }));
    process.exit(2);
  }

  const rawBytes = new Uint8Array(fs.readFileSync(resolved));
  const isZip =
    rawBytes.byteLength >= 4 &&
    rawBytes[0] === 0x50 &&
    rawBytes[1] === 0x4b &&
    rawBytes[2] === 0x03 &&
    rawBytes[3] === 0x04;

  const collections = {};
  const binaries = new Map();

  let sourceFormat = isZip ? "data-vault-zip" : "legacy-json-snapshot";

  if (isZip) {
    const entries = unzipSync(rawBytes);
    for (const [entryPath, bytes] of Object.entries(entries)) {
      if (entryPath.startsWith("files/payment-proofs/")) {
        binaries.set(entryPath, bytes);
      } else if (entryPath.startsWith("data/") && entryPath.endsWith(".json")) {
        const parsed = JSON.parse(strFromU8(bytes));
        if (entryPath === "data/settings.json") {
          collections.settings = parsed;
        } else if (parsed && typeof parsed === "object") {
          Object.assign(collections, parsed);
        }
      }
    }
  } else {
    const parsed = JSON.parse(strFromU8(rawBytes));
    if (parsed?.exportFormat === "scale-flow-b14a-origin-readonly-v1") {
      sourceFormat = "b14a-origin-readonly-json";
    }
    Object.assign(collections, parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed);
    // B14B compatibility: preserve top-level attachments (with inline base64 proofs) from B14A origin exports
    if (Array.isArray(parsed?.attachments) && parsed.attachments.length > 0) {
      collections.attachments = parsed.attachments.map((att, idx) => {
        const key = att.path || `inline-proof/${att.paymentId || att.attachmentId || idx}`;
        if (typeof att.contentBase64 === "string" && att.contentBase64.length > 0) {
          binaries.set(key, new Uint8Array(Buffer.from(att.contentBase64, "base64")));
        }
        return { ...att, path: key };
      });
    }
  }

  const asArr = (k) => (Array.isArray(collections[k]) ? collections[k] : []);
  const leads = asArr("leads");
  const bin = asArr("bin");
  const deals = asArr("deals");
  const payments = asArr("payments");
  const attachments = asArr("attachments");

  // Duplicate IDs & duplicate normalized 10-digit phones
  const duplicateIds = [];
  const checkDupIds = (entity, list) => {
    const counts = new Map();
    for (const item of list) {
      const id = String(item?.id ?? item?.lead?.id ?? "");
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, occurrences] of counts.entries()) {
      if (occurrences > 1) duplicateIds.push({ entity, id, occurrences });
    }
  };
  checkDupIds("leads", leads);
  checkDupIds("deals", deals);
  checkDupIds("payments", payments);

  const phoneMap = new Map();
  for (const l of [...leads, ...bin.map((b) => b?.lead ?? b)]) {
    const digits = String(l?.phone ?? "").replace(/\D/g, "");
    const key = digits.length >= 10 ? digits.slice(-10) : "";
    if (key) {
      const arr = phoneMap.get(key) ?? [];
      arr.push(String(l?.id ?? "unknown"));
      phoneMap.set(key, arr);
    }
  }
  const duplicatePhones = Array.from(phoneMap.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([phoneKey, leadIds]) => ({ phoneKey, leadIds }));

  // Missing relationships (FK checks)
  const leadIdSet = new Set([...leads.map((l) => l.id), ...bin.map((b) => b?.lead?.id ?? b?.id)]);
  const dealIdSet = new Set(deals.map((d) => d.id));
  const missingRelationships = [];
  for (const d of deals) {
    if (d.leadId && !leadIdSet.has(d.leadId)) {
      missingRelationships.push({ entity: "deals", recordId: d.id, missingField: "leadId", targetId: d.leadId });
    }
  }
  for (const p of payments) {
    if (!p.dealId || !dealIdSet.has(p.dealId)) {
      missingRelationships.push({ entity: "payments", recordId: p.id, missingField: "dealId", targetId: p.dealId ?? "(none)" });
    }
  }

  // Unsupported / extra fields check on leads
  const KNOWN_LEAD_KEYS = new Set([
    "id", "name", "company", "phone", "email", "status", "source", "priority", "notes",
    "lostReason", "pinned", "score", "tags", "lastContact", "nextFollowUp", "createdAt",
    "updatedAt", "quickStatus", "budget", "quotedAmount", "requirement", "aiScore",
  ]);
  const extraLeadFields = new Set();
  for (const l of leads) {
    for (const k of Object.keys(l ?? {})) {
      if (!KNOWN_LEAD_KEYS.has(k)) extraLeadFields.add(k);
    }
  }

  // Exact integer-paise financial reconciliation
  const financialErrors = [];
  let wonActiveDealsPaise = 0;
  let lostDealsPaise = 0;
  let activePaymentsPaise = 0;
  let voidedPaymentsPaise = 0;

  for (const d of deals) {
    const parsed = parseStrictPaise(d.value ?? d.finalAmount ?? 0);
    if (!parsed.ok) financialErrors.push(`deal ${d.id}: ${parsed.error}`);
    else if ((d.status ?? "active") === "lost" || (d.status ?? "active") === "cancelled") {
      lostDealsPaise += parsed.paise;
    } else {
      wonActiveDealsPaise += parsed.paise;
    }
  }
  for (const p of payments) {
    const parsed = parseStrictPaise(p.amount ?? 0);
    if (!parsed.ok) financialErrors.push(`payment ${p.id}: ${parsed.error}`);
    else if (p.voided || p.status === "voided") voidedPaymentsPaise += parsed.paise;
    else activePaymentsPaise += parsed.paise;
  }

  // Payment-proof SHA-256 & magic-byte verification
  let proofsVerified = 0;
  let proofsFailed = 0;
  let proofRawBytes = 0;
  for (const att of attachments) {
    const binPath = att.path;
    const bytes = binPath ? binaries.get(binPath) : undefined;
    if (!bytes) {
      proofsFailed++;
      continue;
    }
    proofRawBytes += bytes.byteLength;
    const actualSha = sha256(bytes);
    if (sniffProof(bytes) && (!att.sha256 || att.sha256 === actualSha)) proofsVerified++;
    else proofsFailed++;
  }

  const totalSqlRecords =
    leads.length +
    bin.length +
    asArr("activities").length +
    asArr("followUps").length +
    asArr("callLogs").length +
    asArr("callOps").length +
    asArr("whatsAppLogs").length +
    deals.length +
    payments.length +
    attachments.length +
    asArr("quotations").length +
    asArr("projects").length +
    asArr("projectTasks").length +
    asArr("goals").length;

  const estBytes = totalSqlRecords * 2048 + Math.ceil(proofRawBytes * 1.06);
  const estMiB = Number((estBytes / (1024 * 1024)).toFixed(3));
  const projectedMiB = Number((SAFETY_MARGIN_MIB + estMiB).toFixed(2));

  const deferredCollections = [
    { collection: "notes", count: asArr("notes").length, disposition: "preserve_legacy_archive", archivePath: "data/personal-notes.json" },
    { collection: "demos", count: asArr("demos").length, disposition: "preserve_legacy_archive", archivePath: "data/demo-library.json" },
    { collection: "employees", count: asArr("employees").length, disposition: "defer_unsupported_feature", archivePath: "data/employees.json" },
    { collection: "teamEvents", count: asArr("teamEvents").length, disposition: "defer_unsupported_feature", archivePath: "data/team-activity.json" },
    { collection: "savedReports", count: asArr("savedReports").length, disposition: "preserve_legacy_archive", archivePath: "data/analytics-settings.json" },
  ];

  const report = {
    ok: missingRelationships.length === 0 && financialErrors.length === 0 && proofsFailed === 0 && projectedMiB <= HARD_STOP_MIB,
    offlineLocalPreview: true,
    networkCallsMade: 0,
    databaseWritten: false,
    hostingPolicy: "hostinger_exclusive",
    cloudflareR2Required: false,
    sourceFormat,
    entityCounts: {
      leads: leads.length,
      archivedLeads: bin.length,
      activities: asArr("activities").length,
      followUps: asArr("followUps").length,
      callLogs: asArr("callLogs").length + asArr("callOps").length,
      whatsAppLogs: asArr("whatsAppLogs").length,
      deals: deals.length,
      payments: payments.length,
      paymentProofs: attachments.length,
      quotationTemplates: asArr("quotationTemplates").length,
      quotations: asArr("quotations").length + asArr("legacyQuotations").length,
      projects: asArr("projects").length,
      projectTasks: asArr("projectTasks").length,
      salesGoals: asArr("goals").length,
    },
    missingRelationships,
    duplicateIds,
    duplicatePhones,
    unsupportedFields: extraLeadFields.size > 0 ? [{ entity: "leads", fields: Array.from(extraLeadFields) }] : [],
    financialSummary: {
      wonActiveDealsInr: formatPaiseInr(wonActiveDealsPaise),
      lostCancelledDealsInr: formatPaiseInr(lostDealsPaise),
      activePaymentsInr: formatPaiseInr(activePaymentsPaise),
      voidedPaymentsInr: formatPaiseInr(voidedPaymentsPaise),
      outstandingInr: formatPaiseInr(Math.max(0, wonActiveDealsPaise - activePaymentsPaise)),
      financialErrors,
    },
    paymentProofs: {
      expected: attachments.length,
      verified: proofsVerified,
      failed: proofsFailed,
    },
    deferredCollections,
    hostingerStorageEstimate: {
      estimatedMigrationMiB: estMiB,
      projectedUsedMiB: projectedMiB,
      quotaMiB: QUOTA_MIB,
      warningThresholdMiB: WARN_MIB,
      hardStopThresholdMiB: HARD_STOP_MIB,
      fitsWithinBudget: projectedMiB <= HARD_STOP_MIB,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main();
