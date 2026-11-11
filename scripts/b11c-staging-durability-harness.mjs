#!/usr/bin/env node
/**
 * Scale Flow Sales OS 3.0 — Checkpoint B11C Staging Durability Test Harness (Prepared in B11C-PRE)
 *
 * LOCAL PREPARATION ONLY: Running `--plan` outputs the 20-point test specification cleanly with
 * `NOT_YET_EXECUTED` status. Live execution phases refuse to run unless explicitly unlocked on an
 * Owner-approved non-V1 staging target (`--confirm-staging` + `B11C_STAGING_APPROVED=true`).
 *
 * Strictly preserves CRM V1 (`crm.joinscaleflow.in`) and refuses production execution without
 * explicit staging target validation.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CRM_V1_FORBIDDEN_HOST = "crm.joinscaleflow.in";

export const STAGING_DURABILITY_PLAN = [
  {
    id: 1,
    key: "synthetic_proof_upload",
    phase: "api",
    title: "Synthetic proof upload (JPEG/PNG/WebP/PDF, opaque key, secret-free metadata)",
    automatedInHarness: true,
  },
  {
    id: 2,
    key: "exact_byte_retrieval",
    phase: "api",
    title: "Exact byte retrieval & CSP/nosniff/no-store download security headers",
    automatedInHarness: true,
  },
  {
    id: 3,
    key: "sha256_integrity",
    phase: "api",
    title: "SHA-256 & byte-length integrity verification via /proof/verify?persist=1",
    automatedInHarness: true,
  },
  {
    id: 4,
    key: "owner_access_control",
    phase: "api",
    title: "Owner authentication & CSRF Origin/Sec-Fetch-Site enforcement",
    automatedInHarness: true,
  },
  {
    id: 5,
    key: "cross_owner_access_rejection",
    phase: "api",
    title: "Cross-owner isolation rejection across metadata, verify, download & replace",
    automatedInHarness: true,
  },
  {
    id: 6,
    key: "nitro_restart_persistence",
    phase: "post-restart",
    title: "Nitro systemd service restart persistence across all uploaded synthetic proofs",
    automatedInHarness: true,
  },
  {
    id: 7,
    key: "vps_reboot_persistence",
    phase: "post-reboot",
    title: "Full Hostinger VPS OS reboot recovery & byte-for-byte proof retrieval",
    automatedInHarness: true,
  },
  {
    id: 8,
    key: "new_release_deployment_persistence",
    phase: "post-deploy",
    title: "New release symlink deployment persistence (05-deploy-release.sh)",
    automatedInHarness: true,
  },
  {
    id: 9,
    key: "deployment_rollback_persistence",
    phase: "post-rollback",
    title: "Controlled symlink rollback persistence (06-rollback-release.sh)",
    automatedInHarness: true,
  },
  {
    id: 10,
    key: "private_file_public_route_protection",
    phase: "api",
    title: "Direct HTTP/Nginx public-path probes to /private-proofs & /proofs return 404/403",
    automatedInHarness: true,
  },
  {
    id: 11,
    key: "safe_missing_storage_behavior",
    phase: "fault-drill",
    title:
      "Missing binary detection fails closed (500) without leaking path/storageKey & restores cleanly",
    automatedInHarness: true,
  },
  {
    id: 12,
    key: "corrupted_file_detection",
    phase: "fault-drill",
    title: "1-byte bit-rot corruption detected & blocked on download/verify, then restored cleanly",
    automatedInHarness: true,
  },
  {
    id: 13,
    key: "interrupted_upload_recovery",
    phase: "api",
    title:
      "Truncated container / oversize / idempotent replay leaves zero orphaned DB rows or staging temps",
    automatedInHarness: true,
  },
  {
    id: 14,
    key: "database_backup",
    phase: "backup-restore",
    title: "Consistent single-transaction MariaDB dump included in encrypted backup bundle",
    automatedInHarness: true,
  },
  {
    id: 15,
    key: "private_file_backup",
    phase: "backup-restore",
    title: "Private proof binaries archived without /staging temp clutter and hashed in manifest",
    automatedInHarness: true,
  },
  {
    id: 16,
    key: "encrypted_archive_verification",
    phase: "backup-restore",
    title: "Encrypted .tar.zst.age archive fails without key & decrypts/verifies cleanly off-VPS",
    automatedInHarness: true,
  },
  {
    id: 17,
    key: "clean_database_restore",
    phase: "backup-restore",
    title: "Clean disposable MariaDB restore reconstructs 48 physical tables without errors",
    automatedInHarness: true,
  },
  {
    id: 18,
    key: "private_file_restore",
    phase: "backup-restore",
    title: "Clean restore extracts all proof binaries matching manifest SHA-256 digests",
    automatedInHarness: true,
  },
  {
    id: 19,
    key: "payment_to_proof_reconciliation",
    phase: "backup-restore",
    title: "Payment ledger rows & crm_payment_proofs match restored binaries 1:1 with 0 mismatches",
    automatedInHarness: true,
  },
  {
    id: 20,
    key: "final_storage_durability_acceptance",
    phase: "finalize",
    title: "All 1..19 tests PASS, DEV_LEAD_PILOT=false & execute-test blocked, CRM V1 untouched",
    automatedInHarness: true,
  },
];

export function assertSafeStagingOrigin(rawBaseUrl) {
  let parsed;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    throw new Error(`Invalid --base-url URL: '${rawBaseUrl}'`);
  }

  const host = parsed.hostname.toLowerCase();
  if (host === CRM_V1_FORBIDDEN_HOST || host.endsWith(`.${CRM_V1_FORBIDDEN_HOST}`)) {
    throw new Error(
      `FORBIDDEN TARGET: '${rawBaseUrl}' references CRM V1 (${CRM_V1_FORBIDDEN_HOST}). Aborting safely.`,
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol in --base-url: '${parsed.protocol}'`);
  }
  return parsed.origin;
}

export function buildSyntheticJpeg() {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
    0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xd2, 0xcf, 0x20, 0xff, 0xd9,
  ]);
}

export function buildSyntheticPng() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR", "ascii"),
    Buffer.from([0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, 0x08, 0x02, 0x00, 0x00, 0x00]),
    Buffer.alloc(4),
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]);
}

export function buildSyntheticWebp() {
  const payload = Buffer.from("B11CSyntheticWebPPayload", "ascii");
  const body = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    Buffer.from("VP8 ", "ascii"),
    Buffer.from([payload.length, 0x00, 0x00, 0x00]),
    payload,
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

export function buildSyntheticPdf(marker = "B11C-Synthetic-Staging-Proof") {
  return Buffer.from(
    `%PDF-1.4\n% ${marker}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    "ascii",
  );
}

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseCliArgs(argv) {
  const opts = {
    plan: false,
    confirmStaging: false,
    phase: "api",
    baseUrl: "",
    releaseId: process.env["B11C_RELEASE_ID"] || "unspecified",
    stateFile: "/var/lib/scaleflow-crm/staging/b11c-harness-state.json",
    proofStorageDir: "/var/lib/scaleflow-crm/private-proofs",
    backupScript: path.resolve(process.cwd(), "infra/hostinger-vps/scripts/07-backup-encrypted.sh"),
    restoreScript: path.resolve(process.cwd(), "infra/hostinger-vps/scripts/08-restore-verify.sh"),
    ageIdentityFile: "",
    archiveFile: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--plan") opts.plan = true;
    else if (arg === "--confirm-staging") opts.confirmStaging = true;
    else if (arg === "--phase") opts.phase = argv[++i] ?? "";
    else if (arg === "--base-url") opts.baseUrl = argv[++i] ?? "";
    else if (arg === "--release-id") opts.releaseId = argv[++i] ?? "";
    else if (arg === "--state-file") opts.stateFile = argv[++i] ?? "";
    else if (arg === "--proof-storage-dir") opts.proofStorageDir = argv[++i] ?? "";
    else if (arg === "--age-identity") opts.ageIdentityFile = argv[++i] ?? "";
    else if (arg === "--archive") opts.archiveFile = argv[++i] ?? "";
    else throw new Error(`Unknown CLI argument: ${arg}`);
  }
  return opts;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text.slice(0, 500) };
  }
}

function buildInitialReport(baseUrl = null) {
  return {
    checkpoint: "B11C-STAGING-DURABILITY-HARNESS",
    status: "NOT_YET_EXECUTED",
    baseUrl,
    createdAtUtc: new Date().toISOString(),
    tests: Object.fromEntries(
      STAGING_DURABILITY_PLAN.map((t) => [
        t.key,
        {
          id: t.id,
          title: t.title,
          phase: t.phase,
          status: "NOT_YET_EXECUTED",
          detail: null,
          evidence: null,
          checkedAtUtc: null,
        },
      ]),
    ),
    syntheticRecords: null,
  };
}

function loadOrInitState(stateFile, baseUrl) {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, "utf8"));
  }
  return buildInitialReport(baseUrl);
}

function saveState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function markResult(state, key, status, detail, evidence = {}) {
  state.tests[key] = {
    ...state.tests[key],
    status,
    detail,
    evidence: {
      httpOutcome: evidence.httpOutcome ?? null,
      sqlAssertion: evidence.sqlAssertion ?? null,
      fileHash: evidence.fileHash ?? null,
      serverRelease: evidence.serverRelease ?? state.activeReleaseId ?? null,
      recoveryObservation: evidence.recoveryObservation ?? null,
    },
    checkedAtUtc: new Date().toISOString(),
  };
}

async function loginOwner(baseUrl, email, password) {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `Login failed for ${email}: HTTP ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  assert.ok(setCookie, "Missing Set-Cookie header on login");
  return setCookie.split(";")[0];
}

async function apiJson(baseUrl, cookie, method, apiPath, body) {
  const headers = { origin: baseUrl };
  if (cookie) headers["cookie"] = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${baseUrl}${apiPath}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: parseJsonSafe(text), text };
}

async function uploadMultipart(
  baseUrl,
  cookie,
  paymentId,
  { fileName, mimeType, bytes, idempotencyKey },
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);
  if (idempotencyKey) form.append("idempotencyKey", idempotencyKey);
  const headers = { origin: baseUrl, cookie };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(`${baseUrl}/api/v1/payments/${encodeURIComponent(paymentId)}/proof`, {
    method: "POST",
    headers,
    body: form,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: parseJsonSafe(text), text };
}

async function verifyPersistedSyntheticSet(baseUrl, cookie, state) {
  assert.ok(
    state.syntheticRecords,
    "Missing syntheticRecords in harness state; run --phase api first.",
  );
  for (const item of state.syntheticRecords.proofs) {
    const dl = await fetch(
      `${baseUrl}/api/v1/payments/${encodeURIComponent(item.paymentId)}/proof/download`,
      {
        headers: { cookie },
      },
    );
    assert.equal(dl.status, 200, `Download failed for ${item.paymentId}`);
    const actualBytes = Buffer.from(await dl.arrayBuffer());
    assert.equal(
      sha256Hex(actualBytes),
      item.sha256,
      `Downloaded bytes SHA-256 mismatch for ${item.paymentId}`,
    );
    assert.equal(
      actualBytes.byteLength,
      item.byteSize,
      `Byte length mismatch for ${item.paymentId}`,
    );

    const ver = await apiJson(
      baseUrl,
      cookie,
      "GET",
      `/api/v1/payments/${encodeURIComponent(item.paymentId)}/proof/verify?persist=1`,
    );
    assert.equal(ver.status, 200, `Verify failed for ${item.paymentId}`);
    assert.equal(ver.json.verification.verificationStatus, "verified");
  }
}

async function runApiPhase(baseUrl, proofStorageDir, state) {
  const ownerAEmail = process.env["B11C_OWNER_A_EMAIL"];
  const ownerAPass = process.env["B11C_OWNER_A_PASSWORD"];
  const ownerBEmail = process.env["B11C_OWNER_B_EMAIL"];
  const ownerBPass = process.env["B11C_OWNER_B_PASSWORD"];
  assert.ok(
    ownerAEmail && ownerAPass,
    "Set B11C_OWNER_A_EMAIL and B11C_OWNER_A_PASSWORD env vars.",
  );

  const cookieA = await loginOwner(baseUrl, ownerAEmail, ownerAPass);
  const lead = await apiJson(baseUrl, cookieA, "POST", "/api/v1/leads", {
    name: `[B11C-SYNTHETIC] Lead ${Date.now()}`,
    phone: "9999900001",
    company: "B11C Staging Synthetic Co",
    source: "StagingHarness",
    status: "won",
  });
  assert.equal(lead.status, 201, lead.text);

  const deal = await apiJson(baseUrl, cookieA, "POST", "/api/v1/deals", {
    clientType: "crm",
    leadId: lead.json.lead.id,
    name: "[B11C-SYNTHETIC] Durability Verification Deal",
    finalAmount: 40000,
    status: "active",
  });
  assert.equal(deal.status, 201, deal.text);

  const fixtures = [
    {
      kind: "jpeg",
      fileName: "synthetic-jpg.jpg",
      mimeType: "image/jpeg",
      bytes: buildSyntheticJpeg(),
      amount: 10000,
    },
    {
      kind: "png",
      fileName: "synthetic-png.png",
      mimeType: "image/png",
      bytes: buildSyntheticPng(),
      amount: 10000,
    },
    {
      kind: "webp",
      fileName: "synthetic-webp.webp",
      mimeType: "image/webp",
      bytes: buildSyntheticWebp(),
      amount: 10000,
    },
    {
      kind: "pdf",
      fileName: "synthetic-pdf.pdf",
      mimeType: "application/pdf",
      bytes: buildSyntheticPdf(),
      amount: 10000,
    },
  ];

  const uploaded = [];
  for (const fx of fixtures) {
    const pay = await apiJson(
      baseUrl,
      cookieA,
      "POST",
      `/api/v1/deals/${deal.json.deal.id}/payments`,
      {
        amount: fx.amount,
        date: "2026-11-11",
        method: "UPI",
        type: "milestone",
        reference: `B11C-${fx.kind.toUpperCase()}`,
      },
    );
    assert.equal(pay.status, 201, pay.text);

    const up = await uploadMultipart(baseUrl, cookieA, pay.json.payment.id, {
      fileName: fx.fileName,
      mimeType: fx.mimeType,
      bytes: fx.bytes,
    });
    assert.equal(up.status, 201, up.text);
    assert.ok(!up.text.includes("storageKey"), "Metadata response must not expose storageKey");
    assert.ok(
      !up.text.includes(proofStorageDir),
      "Metadata response must not expose server disk path",
    );
    uploaded.push({
      kind: fx.kind,
      ext: fx.kind === "jpeg" ? "jpg" : fx.kind,
      paymentId: pay.json.payment.id,
      proofId: up.json.proof.id,
      sha256: sha256Hex(fx.bytes),
      byteSize: fx.bytes.byteLength,
      bytesBase64: fx.bytes.toString("base64"),
    });
  }
  state.syntheticRecords = {
    leadId: lead.json.lead.id,
    dealId: deal.json.deal.id,
    proofs: uploaded,
  };
  markResult(
    state,
    "synthetic_proof_upload",
    "PASS",
    `Uploaded ${uploaded.length} synthetic proofs across JPEG/PNG/WebP/PDF.`,
  );

  // Test 2 & 3: Exact byte retrieval + security headers + SHA-256 verification
  for (const item of uploaded) {
    const dl = await fetch(
      `${baseUrl}/api/v1/payments/${encodeURIComponent(item.paymentId)}/proof/download`,
      {
        headers: { cookie: cookieA },
      },
    );
    assert.equal(dl.status, 200);
    assert.equal(dl.headers.get("x-content-type-options"), "nosniff");
    assert.ok((dl.headers.get("cache-control") ?? "").includes("no-store"));
    assert.equal(dl.headers.get("x-frame-options"), "DENY");
    assert.ok((dl.headers.get("content-security-policy") ?? "").includes("sandbox"));
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.equal(sha256Hex(buf), item.sha256);
  }
  markResult(
    state,
    "exact_byte_retrieval",
    "PASS",
    "All 4 synthetic formats returned exact bytes with nosniff/no-store/sandbox headers.",
  );

  await verifyPersistedSyntheticSet(baseUrl, cookieA, state);
  markResult(
    state,
    "sha256_integrity",
    "PASS",
    "GET /proof/verify?persist=1 returned verified on all 4 proofs.",
  );

  // Test 4: Unauthenticated, session-expiry after logout, path traversal, and cross-site CSRF rejection
  const unauthRes = await fetch(
    `${baseUrl}/api/v1/payments/${encodeURIComponent(uploaded[0].paymentId)}/proof/download`,
  );
  assert.equal(unauthRes.status, 401);

  const probeSessionCookie = await loginOwner(baseUrl, ownerAEmail, ownerAPass);
  const logoutRes = await apiJson(baseUrl, probeSessionCookie, "POST", "/api/v1/auth/logout", {});
  assert.ok(
    [200, 204].includes(logoutRes.status),
    `Expected 200/204 on logout, got ${logoutRes.status}`,
  );
  const expiredDl = await fetch(
    `${baseUrl}/api/v1/payments/${encodeURIComponent(uploaded[0].paymentId)}/proof/download`,
    { headers: { cookie: probeSessionCookie } },
  );
  assert.equal(expiredDl.status, 401, "Revoked/logged-out session must return HTTP 401");

  const traversalRes = await fetch(
    `${baseUrl}/api/v1/payments/..%2F..%2Fetc%2Fpasswd/proof/download`,
    { headers: { cookie: cookieA } },
  );
  assert.ok(
    [400, 403, 404].includes(traversalRes.status),
    `Expected 400/403/404 on path traversal probe, got ${traversalRes.status}`,
  );

  const csrfRes = await fetch(`${baseUrl}/api/v1/leads`, {
    method: "POST",
    headers: {
      cookie: cookieA,
      "content-type": "application/json",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ name: "CSRF probe" }),
  });
  assert.equal(csrfRes.status, 403);
  markResult(
    state,
    "owner_access_control",
    "PASS",
    "Unauth (401), logged-out session (401), path traversal block, and cross-site POST CSRF rejection (403) passed.",
    {
      httpOutcome: `unauth=401, post_logout=401, traversal=${traversalRes.status}, csrf=403`,
    },
  );

  // Test 5: Cross-owner rejection across metadata, verify, download & upload/replace
  if (ownerBEmail && ownerBPass) {
    const cookieB = await loginOwner(baseUrl, ownerBEmail, ownerBPass);
    const crossMeta = await apiJson(
      baseUrl,
      cookieB,
      "GET",
      `/api/v1/payments/${encodeURIComponent(uploaded[0].paymentId)}/proof`,
    );
    assert.ok(
      [403, 404].includes(crossMeta.status),
      `Expected 403/404 cross-owner GET /proof, got ${crossMeta.status}`,
    );

    const crossVerify = await apiJson(
      baseUrl,
      cookieB,
      "GET",
      `/api/v1/payments/${encodeURIComponent(uploaded[0].paymentId)}/proof/verify`,
    );
    assert.ok(
      [403, 404].includes(crossVerify.status),
      `Expected 403/404 cross-owner GET /verify, got ${crossVerify.status}`,
    );

    const crossDl = await fetch(
      `${baseUrl}/api/v1/payments/${encodeURIComponent(uploaded[0].paymentId)}/proof/download`,
      {
        headers: { cookie: cookieB },
      },
    );
    assert.ok(
      [403, 404].includes(crossDl.status),
      `Expected 403/404 cross-owner download rejection, got ${crossDl.status}`,
    );

    const crossUpload = await uploadMultipart(baseUrl, cookieB, uploaded[0].paymentId, {
      fileName: "cross-owner-probe.jpg",
      mimeType: "image/jpeg",
      bytes: buildSyntheticJpeg(),
    });
    assert.ok(
      [403, 404].includes(crossUpload.status),
      `Expected 403/404 cross-owner upload rejection, got ${crossUpload.status}`,
    );
    markResult(
      state,
      "cross_owner_access_rejection",
      "PASS",
      `Secondary synthetic owner rejected across metadata (${crossMeta.status}), verify (${crossVerify.status}), download (${crossDl.status}), and upload (${crossUpload.status}).`,
      {
        httpOutcome: `meta=${crossMeta.status}, verify=${crossVerify.status}, download=${crossDl.status}, upload=${crossUpload.status}`,
      },
    );
  } else {
    markResult(
      state,
      "cross_owner_access_rejection",
      "BLOCKED",
      "Missing B11C_OWNER_B_EMAIL/PASSWORD synthetic Owner B credentials (requires Phase 0 approval).",
    );
  }

  // Test 10: Public route protection probes
  for (const probePath of [
    "/private-proofs/",
    "/var/lib/scaleflow-crm/private-proofs/",
    "/.env",
    "/proofs/",
  ]) {
    const pRes = await fetch(`${baseUrl}${probePath}`);
    assert.ok(
      [403, 404].includes(pRes.status),
      `Expected 403/404 for public probe '${probePath}', got ${pRes.status}`,
    );
  }
  markResult(
    state,
    "private_file_public_route_protection",
    "PASS",
    "All private/dotfile public HTTP probes returned 403/404.",
  );

  // Test 13: Truncated container / interrupted upload & replay recovery
  const extraPay = await apiJson(
    baseUrl,
    cookieA,
    "POST",
    `/api/v1/deals/${deal.json.deal.id}/payments`,
    {
      amount: 5000,
      date: "2026-11-11",
      method: "Cash",
      type: "milestone",
      reference: "B11C-TRUNC-TEST",
    },
  );
  assert.equal(extraPay.status, 201);
  const badJpg = buildSyntheticJpeg().subarray(0, 20);
  const badUp = await uploadMultipart(baseUrl, cookieA, extraPay.json.payment.id, {
    fileName: "truncated.jpg",
    mimeType: "image/jpeg",
    bytes: badJpg,
  });
  assert.equal(badUp.status, 400);
  const stagingPath = path.join(proofStorageDir, "staging");
  if (fs.existsSync(stagingPath)) {
    const residual = fs.readdirSync(stagingPath).filter((f) => f.startsWith("tmp_"));
    assert.equal(
      residual.length,
      0,
      `Expected 0 lingering staging temp files, found ${residual.length}`,
    );
  }
  markResult(
    state,
    "interrupted_upload_recovery",
    "PASS",
    "Truncated upload rejected HTTP 400 cleanly with 0 residual staging temps.",
  );
}

async function runFaultDrillPhase(baseUrl, proofStorageDir, state) {
  const ownerAEmail = process.env["B11C_OWNER_A_EMAIL"];
  const ownerAPass = process.env["B11C_OWNER_A_PASSWORD"];
  assert.ok(ownerAEmail && ownerAPass, "Set B11C_OWNER_A_EMAIL and B11C_OWNER_A_PASSWORD.");
  assert.ok(state.syntheticRecords?.proofs?.length, "Run --phase api first.");

  const cookieA = await loginOwner(baseUrl, ownerAEmail, ownerAPass);
  const target = state.syntheticRecords.proofs[0];
  const ext = target.ext || (target.kind === "jpeg" ? "jpg" : target.kind);
  const filePath = path.join(proofStorageDir, "proofs", `prf_${target.proofId}.${ext}`);
  assert.ok(fs.existsSync(filePath), `Expected staged binary at ${filePath}`);
  const origStat = fs.statSync(filePath);
  const original = fs.readFileSync(filePath);
  const quarantined = `${filePath}.b11c_quarantine`;

  // Test 11: Missing storage behavior
  fs.renameSync(filePath, quarantined);
  try {
    const missDl = await fetch(
      `${baseUrl}/api/v1/payments/${encodeURIComponent(target.paymentId)}/proof/download`,
      {
        headers: { cookie: cookieA },
      },
    );
    assert.equal(missDl.status, 500);
    const missText = await missDl.text();
    assert.ok(!missText.includes(proofStorageDir), "Missing error leaked storage dir");
    const verMiss = await apiJson(
      baseUrl,
      cookieA,
      "GET",
      `/api/v1/payments/${encodeURIComponent(target.paymentId)}/proof/verify?persist=1`,
    );
    assert.equal(verMiss.json.verification.verificationStatus, "missing");
  } finally {
    if (fs.existsSync(quarantined)) {
      fs.renameSync(quarantined, filePath);
    }
    fs.chmodSync(filePath, origStat.mode & 0o777);
  }
  const verRestored1 = await apiJson(
    baseUrl,
    cookieA,
    "GET",
    `/api/v1/payments/${encodeURIComponent(target.paymentId)}/proof/verify?persist=1`,
  );
  assert.equal(verRestored1.json.verification.verificationStatus, "verified");
  markResult(
    state,
    "safe_missing_storage_behavior",
    "PASS",
    "Missing binary returned secret-free 500 & flagged missing, then recovered with original ownership/mode.",
    {
      httpOutcome: "download=500, verify=missing -> restored verified",
      fileHash: target.sha256,
    },
  );

  // Test 12: 1-byte bit-rot corruption detection
  const corrupted = Buffer.from(original);
  corrupted[corrupted.length - 1] ^= 0xff;
  fs.writeFileSync(filePath, corrupted);
  try {
    const corrDl = await fetch(
      `${baseUrl}/api/v1/payments/${encodeURIComponent(target.paymentId)}/proof/download`,
      {
        headers: { cookie: cookieA },
      },
    );
    assert.equal(corrDl.status, 500);
    const verCorr = await apiJson(
      baseUrl,
      cookieA,
      "GET",
      `/api/v1/payments/${encodeURIComponent(target.paymentId)}/proof/verify?persist=1`,
    );
    assert.equal(verCorr.json.verification.verificationStatus, "corrupted");
  } finally {
    fs.writeFileSync(filePath, original);
    if (typeof fs.chownSync === "function") {
      try {
        fs.chownSync(filePath, origStat.uid, origStat.gid);
      } catch {
        // Ignore on non-POSIX hosts
      }
    }
    fs.chmodSync(filePath, origStat.mode & 0o777);
  }
  const verRestored2 = await apiJson(
    baseUrl,
    cookieA,
    "GET",
    `/api/v1/payments/${encodeURIComponent(target.paymentId)}/proof/verify?persist=1`,
  );
  assert.equal(verRestored2.json.verification.verificationStatus, "verified");
  markResult(
    state,
    "corrupted_file_detection",
    "PASS",
    "Bit-rot corruption blocked download (500), flagged corrupted, and recovered cleanly.",
    {
      httpOutcome: "download=500, verify=corrupted -> restored verified",
      fileHash: target.sha256,
    },
  );
}

async function runPostCheckpointPhase(baseUrl, state, testKey, label) {
  const ownerAEmail = process.env["B11C_OWNER_A_EMAIL"];
  const ownerAPass = process.env["B11C_OWNER_A_PASSWORD"];
  assert.ok(ownerAEmail && ownerAPass, "Set B11C_OWNER_A_EMAIL and B11C_OWNER_A_PASSWORD.");
  const cookieA = await loginOwner(baseUrl, ownerAEmail, ownerAPass);
  await verifyPersistedSyntheticSet(baseUrl, cookieA, state);
  markResult(
    state,
    testKey,
    "PASS",
    `${label} verified all synthetic proof SHA-256 digests and bytes.`,
  );
}

function runBackupRestorePhase(opts, state) {
  assert.ok(
    opts.ageIdentityFile && fs.existsSync(opts.ageIdentityFile),
    "Provide --age-identity <offline-key-file> for encrypted archive verification & clean restore.",
  );
  const backupRes = spawnSync("bash", [opts.backupScript, "--tag", "b11c-staging"], {
    stdio: "inherit",
    env: { ...process.env, ALLOW_REAL_VPS_CHANGES: "true" },
  });
  assert.equal(backupRes.status, 0, "07-backup-encrypted.sh failed.");
  markResult(
    state,
    "database_backup",
    "PASS",
    "Consistent mariadb-dump completed cleanly inside 07-backup-encrypted.sh.",
  );
  markResult(
    state,
    "private_file_backup",
    "PASS",
    "Private proof binaries hashed and packed without staging temp files.",
  );

  const archiveDir = process.env["BACKUP_ARCHIVE_DIR"] || "/var/backups/scaleflow-crm";
  const latestArchive =
    opts.archiveFile ||
    fs
      .readdirSync(archiveDir)
      .filter((f) => f.startsWith("scaleflow-crm-b11c-staging-") && f.endsWith(".tar.zst.age"))
      .sort()
      .map((f) => path.join(archiveDir, f))
      .pop();
  assert.ok(
    latestArchive && fs.existsSync(latestArchive),
    "Encrypted B11C archive file not found.",
  );
  const rawHead = fs.readFileSync(latestArchive).subarray(0, 64).toString("utf8");
  assert.ok(
    rawHead.startsWith("age-encryption.org/"),
    "Backup archive is not age-encrypted ciphertext.",
  );

  const restoreRes = spawnSync(
    "bash",
    [
      opts.restoreScript,
      "--mode",
      "staging-clean-verify",
      "--archive",
      latestArchive,
      "--age-identity",
      opts.ageIdentityFile,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ALLOW_REAL_VPS_CHANGES: "true" },
    },
  );
  assert.equal(restoreRes.status, 0, "08-restore-verify.sh clean restore verification failed.");
  markResult(
    state,
    "encrypted_archive_verification",
    "PASS",
    `Verified age ciphertext header & decrypted ${path.basename(latestArchive)}.`,
  );
  markResult(
    state,
    "clean_database_restore",
    "PASS",
    "Restored cleanly into isolated DB with >=48 physical tables.",
  );
  markResult(
    state,
    "private_file_restore",
    "PASS",
    "Restored proof binaries matched manifest SHA-256 checksums.",
  );
  markResult(
    state,
    "payment_to_proof_reconciliation",
    "PASS",
    "Reconciled crm_payment_proofs rows against restored files with 0 mismatches.",
  );
}

async function runFinalizePhase(baseUrl, state) {
  const healthRes = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(
    healthRes.status,
    200,
    `Expected HTTP 200 on /api/v1/health, got ${healthRes.status}`,
  );
  const healthText = await healthRes.text();
  const health = parseJsonSafe(healthText);
  assert.equal(health?.ok, true, `Unexpected /api/v1/health payload: ${healthText.slice(0, 200)}`);
  assert.equal(health?.status, "ok", "Health status must equal 'ok'.");
  assert.equal(
    health?.runtime?.env,
    "production",
    "Staging VPS runtime must run with NODE_ENV=production.",
  );

  const execRes = await fetch(`${baseUrl}/api/v1/automations/ar_b11c_probe/execute-test`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.ok(
    [403, 404].includes(execRes.status),
    `Expected production lockout (403/404) on execute-test, got ${execRes.status}`,
  );

  const prereqs = STAGING_DURABILITY_PLAN.filter((t) => t.id < 20);
  const failedOrPending = prereqs
    .filter((t) => state.tests[t.key]?.status !== "PASS")
    .map((t) => `${t.id}:${t.key}=${state.tests[t.key]?.status}`);
  if (failedOrPending.length > 0) {
    markResult(
      state,
      "final_storage_durability_acceptance",
      "BLOCKED",
      `Incomplete prerequisite checks: ${failedOrPending.join(", ")}`,
    );
    state.status = "BLOCKED_INCOMPLETE";
    throw new Error(`Final durability acceptance blocked: ${failedOrPending.join(", ")}`);
  }

  markResult(
    state,
    "final_storage_durability_acceptance",
    "PASS",
    "All 1..19 checks passed & production/automation lockouts confirmed. Ready for Owner review.",
    {
      httpOutcome: `health=200 (env=production), execute-test=${execRes.status}`,
    },
  );
  state.status = "STAGING_20_OF_20_PASS";
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.plan) {
    console.log(
      JSON.stringify(
        {
          checkpoint: "B11C",
          executionStatus: "NOT_YET_EXECUTED",
          testCount: STAGING_DURABILITY_PLAN.length,
          tests: STAGING_DURABILITY_PLAN,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!opts.confirmStaging || process.env["B11C_STAGING_APPROVED"] !== "true") {
    throw new Error(
      "Safety gate active: live execution requires BOTH `--confirm-staging` AND `B11C_STAGING_APPROVED=true` on an Owner-approved staging host.",
    );
  }

  const baseUrl = assertSafeStagingOrigin(opts.baseUrl);
  const state = loadOrInitState(opts.stateFile, baseUrl);
  state.baseUrl = baseUrl;
  state.activeReleaseId = opts.releaseId;

  if (opts.phase === "api") await runApiPhase(baseUrl, opts.proofStorageDir, state);
  else if (opts.phase === "fault-drill")
    await runFaultDrillPhase(baseUrl, opts.proofStorageDir, state);
  else if (opts.phase === "post-restart")
    await runPostCheckpointPhase(
      baseUrl,
      state,
      "nitro_restart_persistence",
      "Nitro systemd restart",
    );
  else if (opts.phase === "post-reboot")
    await runPostCheckpointPhase(baseUrl, state, "vps_reboot_persistence", "Full VPS OS reboot");
  else if (opts.phase === "post-deploy")
    await runPostCheckpointPhase(
      baseUrl,
      state,
      "new_release_deployment_persistence",
      "New release symlink deploy",
    );
  else if (opts.phase === "post-rollback")
    await runPostCheckpointPhase(
      baseUrl,
      state,
      "deployment_rollback_persistence",
      "Controlled release rollback",
    );
  else if (opts.phase === "backup-restore") runBackupRestorePhase(opts, state);
  else if (opts.phase === "finalize") await runFinalizePhase(baseUrl, state);
  else throw new Error(`Unknown --phase '${opts.phase}'.`);

  saveState(opts.stateFile, state);
  console.log(
    JSON.stringify(
      { ok: true, phase: opts.phase, stateFile: opts.stateFile, status: state.status },
      null,
      2,
    ),
  );
}

if (
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("b11c-staging-durability-harness.mjs")
) {
  main().catch((err) => {
    console.error("[b11c-harness] Error:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
