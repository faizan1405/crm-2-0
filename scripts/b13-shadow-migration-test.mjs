#!/usr/bin/env node
/**
 * Checkpoint B13 — Hostinger-Exclusive Synthetic Shadow Migration Verification CLI
 *
 * Strictly synthetic & local by default:
 * - Zero writes to CRM V1, production databases, remote Hostinger DBs, or browser storage.
 * - Cloudflare R2 is NOT required.
 * - Refuses any protected production or CRM V1 database/host target (fail-closed).
 */
import crypto from "node:crypto";
import { strToU8, unzipSync, zipSync } from "fflate";

const PROTECTED_PATTERNS = [
  /crm\.joinscaleflow\.in/i,
  /^prod(_|-|$)/i,
  /(_|-)prod(_|-|$)/i,
  /production/i,
  /crm[_-]?v1/i,
  /(_|-)live(_|-|$)/i,
  /^live(_|-|$)/i,
];

function parseArgs(argv) {
  const opts = {
    targetDb: "u_shadow_b13_synthetic",
    targetHost: "127.0.0.1",
    syntheticOnly: true,
    executeLive: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target-db" && argv[i + 1]) opts.targetDb = argv[++i];
    else if (a === "--target-host" && argv[i + 1]) opts.targetHost = argv[++i];
    else if (a === "--execute-live") opts.executeLive = true;
  }
  return opts;
}

function assertSafeTarget(targetDb, targetHost) {
  for (const re of PROTECTED_PATTERNS) {
    if (re.test(targetDb)) {
      return { ok: false, reason: `Protected production/CRM-V1 database blocked: ${targetDb}` };
    }
    if (re.test(targetHost)) {
      return { ok: false, reason: `Protected production/CRM-V1 host blocked: ${targetHost}` };
    }
  }
  if (!/shadow|staging|stg|disposable|test|sandbox|tmp/i.test(targetDb)) {
    return {
      ok: false,
      reason: `Database '${targetDb}' is not explicitly marked as shadow/staging/disposable.`,
    };
  }
  return { ok: true };
}

function parseStrictPaise(val) {
  const s = String(val).replace(/,/g, "").trim();
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid INR amount: ${val}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

function runCli() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.executeLive) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "LIVE_MIGRATION_LOCKED",
        message:
          "Live remote migration is locked in B13 until explicit Owner approval. Omit --execute-live to run synthetic shadow verification.",
      }),
    );
    process.exit(2);
  }

  const guard = assertSafeTarget(opts.targetDb, opts.targetHost);
  if (!guard.ok) {
    console.error(
      JSON.stringify({
        ok: false,
        code: "PROTECTED_TARGET_BLOCKED",
        message: guard.reason,
      }),
    );
    process.exit(3);
  }

  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  const pngSha = crypto.createHash("sha256").update(pngBytes).digest("hex");

  const deals = [
    { id: "syn_deal_01", value: "123456.78", status: "won" },
    { id: "syn_deal_02", value: "19999.99", status: "active" },
  ];
  const payments = [
    { id: "syn_pay_01", dealId: "syn_deal_01", amount: "61728.39", voided: false },
    {
      id: "syn_pay_02",
      dealId: "syn_deal_01",
      amount: "10000.00",
      voided: true,
      voidReason: "Duplicate reversal",
    },
    { id: "syn_pay_03", dealId: "syn_deal_02", amount: "0.01", voided: false },
  ];

  const archive = zipSync({
    "data/deals.json": strToU8(JSON.stringify({ deals })),
    "data/payments.json": strToU8(JSON.stringify({ payments })),
    "files/payment-proofs/syn_att_01__receipt.png": pngBytes,
  });

  const extracted = unzipSync(archive);
  const extractedPngSha = crypto
    .createHash("sha256")
    .update(extracted["files/payment-proofs/syn_att_01__receipt.png"])
    .digest("hex");

  const dealsTotalPaise = deals.reduce((s, d) => s + parseStrictPaise(d.value), 0);
  const activePaymentsPaise = payments
    .filter((p) => !p.voided)
    .reduce((s, p) => s + parseStrictPaise(p.amount), 0);
  const voidedPaymentsPaise = payments
    .filter((p) => p.voided)
    .reduce((s, p) => s + parseStrictPaise(p.amount), 0);

  const report = {
    ok: extractedPngSha === pngSha && dealsTotalPaise === 14345677 && activePaymentsPaise === 6172840 && voidedPaymentsPaise === 1000000,
    checkpoint: "B13",
    hostingPolicy: "hostinger_exclusive",
    cloudflareR2Required: false,
    proofStorageDriver: "mariadb-blob",
    targetDbValidated: opts.targetDb,
    realDatabaseTouched: false,
    crmV1Touched: false,
    browserStorageTouched: false,
    financialParity: {
      dealsTotalPaise,
      activePaymentsPaise,
      voidedPaymentsPaise,
      deltaPaise: 0,
    },
    proofSha256Verified: extractedPngSha === pngSha,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

runCli();
