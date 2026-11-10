import { describe, expect, it } from "vitest";
import {
  buildFinancialSummary,
  buildManifest,
  canonicalJsonStringify,
  computeSha256,
  scrubSensitiveFields,
} from "./backup/manifest.server";
import {
  BACKUP_APP_NAME,
  BACKUP_FORMAT_VERSION,
  BUSINESS_TIMEZONE,
  CURRENT_CRM_SCHEMA_VERSION,
} from "./backup/types.server";

describe("B7A — Backup Manifest & Deterministic Integrity Utilities", () => {
  it("scrubSensitiveFields removes passwords, tokens, hashes, secrets and cookies recursively", () => {
    const raw = {
      id: "usr_1",
      email: "owner@scale.flow",
      name: "Owner User",
      password_hash: "secret_argon2_hash",
      token: "secret_session_token",
      auth_secret: "jwt_hmac_secret",
      nested: {
        apiKey: "sk_live_12345",
        cookie: "session=xyz",
        leadName: "Acme Corp",
      },
      list: [
        { password: "123", validField: "ok" },
        { tokenHash: "abc", count: 10 },
      ],
    };

    const scrubbed = scrubSensitiveFields(raw) as Record<string, unknown> & {
      nested: Record<string, unknown>;
      list: Array<Record<string, unknown>>;
    };
    expect(scrubbed["id"]).toBe("usr_1");
    expect(scrubbed["email"]).toBe("owner@scale.flow");
    expect(scrubbed["password_hash"]).toBeUndefined();
    expect(scrubbed["token"]).toBeUndefined();
    expect(scrubbed["auth_secret"]).toBeUndefined();
    expect(scrubbed.nested["apiKey"]).toBeUndefined();
    expect(scrubbed.nested["cookie"]).toBeUndefined();
    expect(scrubbed.nested["leadName"]).toBe("Acme Corp");
    expect(scrubbed.list[0]!["password"]).toBeUndefined();
    expect(scrubbed.list[0]!["validField"]).toBe("ok");
    expect(scrubbed.list[1]!["tokenHash"]).toBeUndefined();
    expect(scrubbed.list[1]!["count"]).toBe(10);
  });

  it("canonicalJsonStringify generates deterministic key-sorted output regardless of insertion order", () => {
    const objA = { z: 1, a: 2, m: { y: "b", x: "a" } };
    const objB = { a: 2, m: { x: "a", y: "b" }, z: 1 };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);

    expect(strA).toBe(strB);
    expect(computeSha256(strA)).toBe(computeSha256(strB));
  });

  it("buildFinancialSummary accurately computes active paise, voided paise, and deal totals", () => {
    const deals = [
      { id: "deal_1", status: "won", valuePaise: 500000 }, // ₹5,000.00
      { id: "deal_2", status: "lost", valuePaise: 250000 }, // ₹2,500.00
      { id: "deal_3", status: "active", value: 1000 }, // ₹1,000.00 -> 100000 paise
    ];

    const payments = [
      { id: "pay_1", dealId: "deal_1", amountPaise: 250000, voided: false },
      { id: "pay_2", dealId: "deal_1", amountPaise: 250000, voided: false },
      { id: "pay_3", dealId: "deal_1", amountPaise: 100000, voided: true }, // voided
    ];

    const summary = buildFinancialSummary({ deals, payments });

    expect(summary.totalPaymentsCount).toBe(3);
    expect(summary.activePaymentsCount).toBe(2);
    expect(summary.activePaymentsPaise).toBe(500000);
    expect(summary.voidedPaymentsCount).toBe(1);
    expect(summary.voidedPaymentsPaise).toBe(100000);
    expect(summary.totalPaymentsPaise).toBe(600000);
    expect(summary.totalPaymentsFormattedInr).toBe("₹5,000.00");

    expect(summary.totalBookedDealsCount).toBe(3);
    expect(summary.totalBookedDealsPaise).toBe(850000);
    expect(summary.dealsWonCount).toBe(1);
    expect(summary.dealsLostCount).toBe(1);
    expect(summary.dealsActiveCount).toBe(1);
  });

  it("buildManifest creates a complete manifest with self-calculating SHA-256 and verified classification", () => {
    const summary = buildFinancialSummary({
      deals: [{ id: "deal_1", status: "won", valuePaise: 100000 }],
      payments: [{ id: "pay_1", dealId: "deal_1", amountPaise: 100000, voided: false }],
    });

    const manifest = buildManifest({
      type: "full",
      ownerUserId: "usr_owner_1",
      ownerEmail: "owner@scale.flow",
      includedEntities: ["leads", "deals", "payments", "proofs"],
      omittedEntities: [],
      counts: { leads: 1, deals: 1, payments: 1, proofs: 1 },
      financialSummary: summary,
      attachmentsMeta: [
        {
          attachmentId: "att_1",
          paymentId: "pay_1",
          originalFileName: "receipt.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
          sha256: "abc123sha",
          path: "files/payment-proofs/pay_1__receipt.pdf",
          uploadedAt: "2026-11-10T10:00:00Z",
          status: "verified",
        },
      ],
      files: [
        { path: "data/leads.json", sha256: "sha_leads", bytes: 250 },
        { path: "data/deals.json", sha256: "sha_deals", bytes: 300 },
        { path: "data/payments.json", sha256: "sha_payments", bytes: 280 },
        { path: "files/payment-proofs/pay_1__receipt.pdf", sha256: "abc123sha", bytes: 1024 },
      ],
    });

    expect(manifest.app).toBe(BACKUP_APP_NAME);
    expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.schemaVersion).toBe(CURRENT_CRM_SCHEMA_VERSION);
    expect(manifest.timezone).toBe(BUSINESS_TIMEZONE);
    expect(manifest.complete).toBe(true);
    expect(manifest.classification).toBe("complete");
    expect(manifest.attachments.expected).toBe(1);
    expect(manifest.attachments.included).toBe(1);
    expect(manifest.attachments.missingCount).toBe(0);
    expect(manifest.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
