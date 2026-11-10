import { describe, expect, it } from "vitest";
import { isSensitiveKey, scrubSensitiveFields } from "./backup/manifest.server";

describe("B7A-QA — Credential Scrubbing & Legitimate Integrity Preservation", () => {
  it("strips sensitive authentication, passwords, tokens and secret keys", () => {
    const sensitiveRecord = {
      id: "usr_101",
      email: "owner@joinscaleflow.in",
      password: "PlainTextSecretPassword!",
      password_hash: "scrypt$N=32768,r=8,p=1$...",
      authToken: "jwt_token_sample",
      sessionCookie: "session_cookie_123",
      apiKey: "sk-live-crm-secret-key",
      apiSecret: "api_sec_abc123",
      privateKey: "-----BEGIN PRIVATE KEY-----",
      notes: "Legitimate customer discussion note mentioning payment details",
    };

    const scrubbed = scrubSensitiveFields(sensitiveRecord);

    expect(scrubbed.id).toBe("usr_101");
    expect(scrubbed.email).toBe("owner@joinscaleflow.in");
    expect(scrubbed.notes).toBe("Legitimate customer discussion note mentioning payment details");

    expect(scrubbed.password).toBeUndefined();
    expect(scrubbed.password_hash).toBeUndefined();
    expect(scrubbed.authToken).toBeUndefined();
    expect(scrubbed.sessionCookie).toBeUndefined();
    expect(scrubbed.apiKey).toBeUndefined();
    expect(scrubbed.apiSecret).toBeUndefined();
    expect(scrubbed.privateKey).toBeUndefined();
  });

  it("strictly PRESERVES legitimate integrity hashes, SHA-256 digests, and transaction references", () => {
    const proofAndLedgerRecord = {
      id: "pay_qa_999",
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      sha256Hash: "d41d8cd98f00b204e9800998ecf8427e00000000000000000000000000000000",
      fileHash: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      proofHash: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      txHash: "0x4b7914f6b0f92b70f69903b41d013063870bb1ad042125bb76f007bb779b5c2c",
      transactionHash: "0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678",
      reference: "UPI/2026/TXN9876543210",
      checksum: "a1b2c3d4e5f6",
    };

    const scrubbed = scrubSensitiveFields(proofAndLedgerRecord);

    expect(scrubbed.id).toBe("pay_qa_999");
    expect(scrubbed.sha256).toBe(proofAndLedgerRecord.sha256);
    expect(scrubbed.sha256Hash).toBe(proofAndLedgerRecord.sha256Hash);
    expect(scrubbed.fileHash).toBe(proofAndLedgerRecord.fileHash);
    expect(scrubbed.proofHash).toBe(proofAndLedgerRecord.proofHash);
    expect(scrubbed.txHash).toBe(proofAndLedgerRecord.txHash);
    expect(scrubbed.transactionHash).toBe(proofAndLedgerRecord.transactionHash);
    expect(scrubbed.reference).toBe("UPI/2026/TXN9876543210");
    expect(scrubbed.checksum).toBe("a1b2c3d4e5f6");
  });

  it("verifies isSensitiveKey accurately differentiates secrets from integrity keys", () => {
    // Should be preserved
    expect(isSensitiveKey("sha256")).toBe(false);
    expect(isSensitiveKey("sha256Hash")).toBe(false);
    expect(isSensitiveKey("fileHash")).toBe(false);
    expect(isSensitiveKey("proofHash")).toBe(false);
    expect(isSensitiveKey("txHash")).toBe(false);
    expect(isSensitiveKey("transactionHash")).toBe(false);
    expect(isSensitiveKey("reference")).toBe(false);
    expect(isSensitiveKey("id")).toBe(false);
    expect(isSensitiveKey("checksum")).toBe(false);

    // Should be scrubbed
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("password_hash")).toBe(true);
    expect(isSensitiveKey("token")).toBe(true);
    expect(isSensitiveKey("authToken")).toBe(true);
    expect(isSensitiveKey("sessionToken")).toBe(true);
    expect(isSensitiveKey("apiKey")).toBe(true);
    expect(isSensitiveKey("api_secret")).toBe(true);
    expect(isSensitiveKey("cookie")).toBe(true);
    expect(isSensitiveKey("sessionCookie")).toBe(true);
  });
});
