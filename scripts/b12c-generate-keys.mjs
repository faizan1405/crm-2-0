#!/usr/bin/env node
/**
 * Scale Flow CRM V2 — Checkpoint B12C
 * Owner-Controlled age X25519 Backup Key Generator
 *
 * Security Rules:
 * - Generates standard age-encryption.org/v1 (X25519) keypair in memory.
 * - Displays public key (for Hostinger BACKUP_AGE_RECIPIENT_PUBKEY).
 * - Displays secret recovery key (for Owner's offline custody ONLY).
 * - NEVER writes secret key to repository files or disk.
 */

import { generateAgeX25519KeyPair } from "./b11c-backup-crypto.mjs";

console.log("================================================================================");
console.log("SCALE FLOW CRM V2 — CHECKPOINT B12C ENCRYPTION KEY GENERATOR");
console.log("================================================================================");
console.log("");

const keypair = generateAgeX25519KeyPair();

console.log("1. PUBLIC ENCRYPTION KEY (Add to Hostinger / staging .env):");
console.log(`   BACKUP_AGE_RECIPIENT_PUBKEY=${keypair.publicKey}`);
console.log("");
console.log("2. SECRET RECOVERY KEY (Store in 1Password / secure offline vault):");
console.log(`   ${keypair.secretKey}`);
console.log("");
console.log("================================================================================");
console.log("CRITICAL SECURITY INSTRUCTIONS FOR OWNER:");
console.log("- The SECRET RECOVERY KEY must NEVER be uploaded to Hostinger, Git, or staging.");
console.log("- Hostinger requires ONLY the PUBLIC KEY to produce encrypted backups.");
console.log("- Without the SECRET KEY, nobody (including Hostinger) can read the database dumps.");
console.log("================================================================================");
