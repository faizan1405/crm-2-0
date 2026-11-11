/**
 * Scale Flow CRM V2 — Checkpoint B11C-LAUNCH-HARDENING
 * Zero-Dependency Standard age v1 (X25519 + ChaCha20-Poly1305 STREAM) + Gzip Stream Crypto
 *
 * Security Rules:
 * - Backup producer ONLY accepts public recipient keys (`age1...`) and NEVER requires or accepts
 *   private decryption keys (`AGE-SECRET-KEY-1...`) on hosting runtimes.
 * - Uses O(1) 64 KiB streaming I/O during encrypt/decrypt so Hostinger memory limits stay safe.
 * - Always authenticates header HMAC before reading payload chunks and enforces STREAM final-chunk
 *   authenticity to reject truncation, bit-flips, wrong keys, and malformed envelopes.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

export const AGE_V1_HEADER_LINE = "age-encryption.org/v1";
export const AGE_STREAM_CHUNK_BYTES = 65_536; // 64 KiB standard age v1 STREAM chunk size
export const AGE_STREAM_TAG_BYTES = 16;
export const AGE_PUBLIC_KEY_RE = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
export const AGE_SECRET_KEY_RE = /^AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}$/;

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const UNSAFE_BACKUP_PATH_RE =
  /(?:^|[\\/])(public_html|htdocs|wwwroot|\.output|hbuilds|dist|node_modules)(?:[\\/]|$)|(?:^|[\\/])src[\\/]public(?:[\\/]|$)/i;

// #region Pure Bech32 (BIP-173) for canonical age1... / AGE-SECRET-KEY-1... keys

function bech32Polymod(values) {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GENERATORS[i];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    if (value < 0 || value >> fromBits !== 0) {
      throw new Error("Invalid value range for bech32 bit conversion.");
    }
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) {
      ret.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error("Invalid bech32 trailing bits.");
  }
  return ret;
}

export function bech32Encode(hrp, dataBytes, uppercase = false) {
  const lowerHrp = hrp.toLowerCase();
  const words = convertBits(dataBytes, 8, 5, true);
  const values = [...bech32HrpExpand(lowerHrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod(values) ^ 1;
  const checksum = [];
  for (let p = 0; p < 6; p++) {
    checksum.push((mod >> (5 * (5 - p))) & 31);
  }
  const encoded = `${lowerHrp}1${[...words, ...checksum].map((v) => BECH32_CHARSET[v]).join("")}`;
  return uppercase ? encoded.toUpperCase() : encoded;
}

export function bech32Decode(str) {
  if (typeof str !== "string" || str.length < 8) {
    throw new Error("Invalid bech32 key format.");
  }
  const hasLower = str !== str.toUpperCase();
  const hasUpper = str !== str.toLowerCase();
  if (hasLower && hasUpper) {
    throw new Error("Mixed-case bech32 string is invalid.");
  }
  const lower = str.toLowerCase();
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) {
    throw new Error("Malformed bech32 separator.");
  }
  const hrp = lower.slice(0, pos);
  const data = [];
  for (let i = pos + 1; i < lower.length; i++) {
    const idx = BECH32_CHARSET.indexOf(lower[i]);
    if (idx === -1) {
      throw new Error("Invalid character in bech32 key.");
    }
    data.push(idx);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== 1) {
    throw new Error("Invalid bech32 checksum on age key.");
  }
  const bytes = Buffer.from(convertBits(data.slice(0, -6), 5, 8, false));
  return { hrp, bytes };
}

// #endregion

function toBase64NoPad(buf) {
  return buf.toString("base64").replace(/=+$/g, "");
}

function fromBase64NoPad(str) {
  if (typeof str !== "string" || /=/.test(str) || /[^A-Za-z0-9+/]/.test(str)) {
    throw new Error("Invalid unpadded base64 field in age header.");
  }
  const mod = str.length % 4;
  if (mod === 1) {
    throw new Error("Corrupted base64 length in age header.");
  }
  const padded = mod === 0 ? str : str + "=".repeat(4 - mod);
  const decoded = Buffer.from(padded, "base64");
  if (toBase64NoPad(decoded) !== str) {
    throw new Error("Non-canonical base64 padding in age header.");
  }
  return decoded;
}

function wrapBase6464Cols(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) {
    lines.push(b64.slice(i, i + 64));
  }
  if (b64.length % 64 === 0) {
    lines.push("");
  }
  return lines.join("\n");
}

function buildX25519PublicKeyFromRaw(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.byteLength !== 32) {
    throw new Error("Expected 32-byte X25519 public key.");
  }
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw32]),
    format: "der",
    type: "spki",
  });
}

function buildX25519PrivateKeyFromRaw(raw32) {
  if (!Buffer.isBuffer(raw32) || raw32.byteLength !== 32) {
    throw new Error("Expected 32-byte X25519 secret scalar.");
  }
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw32]),
    format: "der",
    type: "pkcs8",
  });
}

function isAllZero(buf) {
  for (let i = 0; i < buf.byteLength; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function buildStreamNonce(chunkCounterBigInt, isFinal) {
  const nonce = Buffer.alloc(12);
  let counter = chunkCounterBigInt;
  for (let i = 10; i >= 0; i--) {
    nonce[i] = Number(counter & 0xffn);
    counter >>= 8n;
  }
  nonce[11] = isFinal ? 0x01 : 0x00;
  return nonce;
}

/** Validates destination/backup paths so encrypted or temporary artifacts never enter web/build trees. */
export function assertSafeBackupFilePath(filePath, label = "backup path") {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error(`Invalid ${label}: path cannot be empty.`);
  }
  const normalized = path.resolve(filePath);
  if (UNSAFE_BACKUP_PATH_RE.test(normalized)) {
    throw new Error(
      `Refusing ${label} inside webroot or build artifact directory: ${path.basename(normalized)}`,
    );
  }
  return normalized;
}

/** Rejects hosting-resident private keys in backup producer environment variables. */
export function assertBackupProducerEnvHasNoPrivateKey(env = process.env) {
  const suspiciousKeys = [
    "AGE_SECRET_KEY",
    "BACKUP_AGE_SECRET_KEY",
    "BACKUP_AGE_PRIVATE_KEY",
    "BACKUP_PRIVATE_KEY",
  ];
  for (const key of suspiciousKeys) {
    const val = env[key];
    if (typeof val === "string" && val.trim().length > 0) {
      throw new Error(
        `Security policy violation: private decryption key (${key}) must NOT be stored in the backup producer environment. Keep owner secret keys strictly offline.`,
      );
    }
  }
}

/** Generates a standard age v1 X25519 keypair (`age1...` public recipient + `AGE-SECRET-KEY-1...` offline identity). */
export function generateAgeX25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const pubRaw = spki.subarray(spki.byteLength - 32);
  const privRaw = pkcs8.subarray(pkcs8.byteLength - 32);
  return {
    publicKey: bech32Encode("age", pubRaw, false),
    secretKey: bech32Encode("age-secret-key-", privRaw, true),
    publicKeyFingerprintSha256: crypto.createHash("sha256").update(pubRaw).digest("hex"),
  };
}

/** Parses and verifies an age v1 public recipient key (`age1...`). */
export function parseAgePublicKey(publicKey) {
  if (!AGE_PUBLIC_KEY_RE.test(String(publicKey ?? "").trim())) {
    throw new Error("Invalid age public key format (expected age1... lowercase 62-char key).");
  }
  const trimmed = publicKey.trim();
  const decoded = bech32Decode(trimmed);
  if (decoded.hrp !== "age" || decoded.bytes.byteLength !== 32) {
    throw new Error("Decoded age public key does not represent a 32-byte X25519 recipient.");
  }
  return {
    recipient: trimmed,
    rawPublicKey: decoded.bytes,
    keyObject: buildX25519PublicKeyFromRaw(decoded.bytes),
  };
}

/** Parses and verifies an age v1 secret identity key (`AGE-SECRET-KEY-1...`) and derives its public recipient. */
export function parseAgeSecretKey(secretKey) {
  const trimmed = String(secretKey ?? "")
    .trim()
    .toUpperCase();
  if (!AGE_SECRET_KEY_RE.test(trimmed)) {
    throw new Error("Invalid age secret key format (expected AGE-SECRET-KEY-1...).");
  }
  const decoded = bech32Decode(trimmed);
  if (decoded.hrp !== "age-secret-key-" || decoded.bytes.byteLength !== 32) {
    throw new Error("Decoded age secret key does not represent a 32-byte X25519 scalar.");
  }
  const privObj = buildX25519PrivateKeyFromRaw(decoded.bytes);
  const pubSpki = crypto.createPublicKey(privObj).export({ format: "der", type: "spki" });
  const rawPublicKey = pubSpki.subarray(pubSpki.byteLength - 32);
  return {
    rawSecretKey: decoded.bytes,
    rawPublicKey,
    publicKey: bech32Encode("age", rawPublicKey, false),
    privateKeyObject: privObj,
  };
}

/**
 * Encrypts a source file into a standard age v1 (`age-encryption.org/v1`) binary file using X25519
 * recipient wrapping + authenticated 64 KiB ChaCha20-Poly1305 STREAM chunks (`O(1)` memory).
 */
export async function encryptFileWithAgeX25519({ inputPath, outputPath, recipientPublicKey }) {
  const safeInput = assertSafeBackupFilePath(inputPath, "plaintext input");
  const safeOutput = assertSafeBackupFilePath(outputPath, "encrypted backup output");
  const recipient = parseAgePublicKey(recipientPublicKey);

  const fileKey = crypto.randomBytes(16);
  const eph = crypto.generateKeyPairSync("x25519");
  const epkSpki = eph.publicKey.export({ format: "der", type: "spki" });
  const epkRaw = epkSpki.subarray(epkSpki.byteLength - 32);

  const sharedSecret = crypto.diffieHellman({
    privateKey: eph.privateKey,
    publicKey: recipient.keyObject,
  });
  if (isAllZero(sharedSecret)) {
    throw new Error("X25519 shared secret is all zeros.");
  }

  const wrapSalt = Buffer.concat([epkRaw, recipient.rawPublicKey]);
  const wrapKey = Buffer.from(
    crypto.hkdfSync(
      "sha256",
      sharedSecret,
      wrapSalt,
      Buffer.from("age-encryption.org/v1/X25519"),
      32,
    ),
  );
  const wrapCipher = crypto.createCipheriv("chacha20-poly1305", wrapKey, Buffer.alloc(12));
  const wrappedCt = wrapCipher.update(fileKey);
  const wrappedFinal = wrapCipher.final();
  const wrapTag = wrapCipher.getAuthTag();
  const wrappedStanzaBody = toBase64NoPad(Buffer.concat([wrappedCt, wrappedFinal, wrapTag]));

  const headerWithoutMac =
    `${AGE_V1_HEADER_LINE}\n` +
    `-> X25519 ${toBase64NoPad(epkRaw)}\n` +
    `${wrapBase6464Cols(wrappedStanzaBody)}\n` +
    `---`;

  const hmacKey = Buffer.from(
    crypto.hkdfSync("sha256", fileKey, Buffer.alloc(0), Buffer.from("header"), 32),
  );
  const headerMac = crypto.createHmac("sha256", hmacKey).update(headerWithoutMac, "utf8").digest();
  const fullHeader = Buffer.from(`${headerWithoutMac} ${toBase64NoPad(headerMac)}\n`, "utf8");

  const streamNonce = crypto.randomBytes(16);
  const payloadKey = Buffer.from(
    crypto.hkdfSync("sha256", fileKey, streamNonce, Buffer.from("payload"), 32),
  );

  fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
  const outTempPath = `${safeOutput}.tmp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

  let inFd = null;
  let outFd = null;
  const outputHash = crypto.createHash("sha256");

  try {
    inFd = fs.openSync(safeInput, "r");
    outFd = fs.openSync(outTempPath, "w", 0o600);

    const writeOut = (buf) => {
      outputHash.update(buf);
      fs.writeSync(outFd, buf, 0, buf.byteLength);
    };

    writeOut(fullHeader);
    writeOut(streamNonce);

    const stat = fs.fstatSync(inFd);
    let remaining = stat.size;
    let chunkCounter = 0n;
    const readBuf = Buffer.allocUnsafe(AGE_STREAM_CHUNK_BYTES);

    if (remaining === 0) {
      const cipher = crypto.createCipheriv(
        "chacha20-poly1305",
        payloadKey,
        buildStreamNonce(0n, true),
      );
      const ct = cipher.update(Buffer.alloc(0));
      const fin = cipher.final();
      const tag = cipher.getAuthTag();
      writeOut(Buffer.concat([ct, fin, tag]));
    } else {
      while (remaining > 0) {
        const toRead = Math.min(AGE_STREAM_CHUNK_BYTES, remaining);
        const bytesRead = fs.readSync(inFd, readBuf, 0, toRead, null);
        if (bytesRead <= 0) {
          throw new Error("Unexpected EOF while reading plaintext input for age encryption.");
        }
        remaining -= bytesRead;
        const isFinal = remaining === 0;
        const chunkPlain = readBuf.subarray(0, bytesRead);
        const cipher = crypto.createCipheriv(
          "chacha20-poly1305",
          payloadKey,
          buildStreamNonce(chunkCounter, isFinal),
        );
        const ct = cipher.update(chunkPlain);
        const fin = cipher.final();
        const tag = cipher.getAuthTag();
        writeOut(Buffer.concat([ct, fin, tag]));
        chunkCounter += 1n;
      }
    }

    fs.closeSync(outFd);
    outFd = null;
    fs.closeSync(inFd);
    inFd = null;

    fs.renameSync(outTempPath, safeOutput);
    const outStat = fs.statSync(safeOutput);
    return {
      outputPath: safeOutput,
      plaintextBytes: stat.size,
      encryptedBytes: outStat.size,
      encryptedSha256: outputHash.digest("hex"),
      recipientPublicKey: recipient.recipient,
    };
  } catch (err) {
    if (outFd !== null) {
      try {
        fs.closeSync(outFd);
      } catch {}
    }
    if (inFd !== null) {
      try {
        fs.closeSync(inFd);
      } catch {}
    }
    try {
      if (fs.existsSync(outTempPath)) fs.unlinkSync(outTempPath);
    } catch {}
    throw err;
  } finally {
    fileKey.fill(0);
    wrapKey.fill(0);
    payloadKey.fill(0);
    sharedSecret.fill(0);
  }
}

/** Parses and validates an age v1 header from a file descriptor, returning offset of encrypted payload. */
export function readAndParseAgeHeader(fd) {
  const headProbe = Buffer.alloc(65_536);
  const bytesRead = fs.readSync(fd, headProbe, 0, headProbe.byteLength, 0);
  const headSlice = headProbe.subarray(0, bytesRead);

  // Locate `\n--- ` marker ending the authenticated header lines
  let markerOffset = -1;
  for (let i = 0; i < headSlice.byteLength - 4; i++) {
    if (
      headSlice[i] === 0x0a &&
      headSlice[i + 1] === 0x2d &&
      headSlice[i + 2] === 0x2d &&
      headSlice[i + 3] === 0x2d &&
      headSlice[i + 4] === 0x20
    ) {
      markerOffset = i + 1;
      break;
    }
  }
  if (markerOffset === -1) {
    throw new Error("Invalid age archive: missing `---` header MAC delimiter.");
  }

  const macLineEnd = headSlice.indexOf(0x0a, markerOffset);
  if (macLineEnd === -1) {
    throw new Error("Invalid age archive: truncated header MAC line.");
  }

  const headerWithoutMac = headSlice.subarray(0, markerOffset + 3).toString("utf8");
  const macLine = headSlice.subarray(markerOffset, macLineEnd).toString("utf8");
  const macParts = macLine.split(" ");
  if (macParts.length !== 2 || macParts[0] !== "---") {
    throw new Error("Invalid age archive: malformed header MAC footer.");
  }
  const headerMac = fromBase64NoPad(macParts[1]);

  const lines = headerWithoutMac.slice(0, -4).split("\n");
  if (lines[0] !== AGE_V1_HEADER_LINE) {
    throw new Error(`Unsupported age version line: ${lines[0] ?? "<empty>"}`);
  }

  const stanzas = [];
  for (let i = 1; i < lines.length;) {
    const line = lines[i];
    if (!line.startsWith("-> ")) {
      throw new Error("Malformed recipient stanza prefix in age header.");
    }
    const stanzaArgs = line.slice(3).split(" ");
    const bodyLines = [];
    i++;
    while (i < lines.length && !lines[i].startsWith("-> ")) {
      if (lines[i].length > 64) {
        throw new Error("Age stanza body line exceeds 64 columns.");
      }
      bodyLines.push(lines[i]);
      if (lines[i].length < 64) {
        i++;
        break;
      }
      i++;
    }
    stanzas.push({
      type: stanzaArgs[0],
      args: stanzaArgs.slice(1),
      body: fromBase64NoPad(bodyLines.join("")),
    });
  }

  return {
    headerWithoutMac,
    headerMac,
    stanzas,
    payloadOffset: macLineEnd + 1,
  };
}

/**
 * Decrypts a standard age v1 X25519 archive with caller-supplied offline secret key (`AGE-SECRET-KEY-1...`),
 * verifying stanza wrap auth tag, header HMAC, and every STREAM chunk Poly1305 tag + final-chunk flag.
 */
export async function decryptFileWithAgeX25519({ inputPath, outputPath, secretKey }) {
  const safeInput = assertSafeBackupFilePath(inputPath, "encrypted archive input");
  const safeOutput = assertSafeBackupFilePath(outputPath, "decrypted output");
  const identity = parseAgeSecretKey(secretKey);

  let inFd = null;
  let outFd = null;
  const tempOutPath = `${safeOutput}.tmp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

  try {
    inFd = fs.openSync(safeInput, "r");
    const stat = fs.fstatSync(inFd);
    const header = readAndParseAgeHeader(inFd);

    let fileKey = null;
    for (const stanza of header.stanzas) {
      if (stanza.type !== "X25519" || stanza.args.length !== 1 || stanza.body.byteLength !== 32) {
        continue;
      }
      const epkRaw = fromBase64NoPad(stanza.args[0]);
      if (epkRaw.byteLength !== 32) continue;

      const sharedSecret = crypto.diffieHellman({
        privateKey: identity.privateKeyObject,
        publicKey: buildX25519PublicKeyFromRaw(epkRaw),
      });
      if (isAllZero(sharedSecret)) {
        sharedSecret.fill(0);
        continue;
      }
      const wrapSalt = Buffer.concat([epkRaw, identity.rawPublicKey]);
      const wrapKey = Buffer.from(
        crypto.hkdfSync(
          "sha256",
          sharedSecret,
          wrapSalt,
          Buffer.from("age-encryption.org/v1/X25519"),
          32,
        ),
      );
      sharedSecret.fill(0);

      try {
        const decipher = crypto.createDecipheriv("chacha20-poly1305", wrapKey, Buffer.alloc(12));
        decipher.setAuthTag(stanza.body.subarray(16, 32));
        const p1 = decipher.update(stanza.body.subarray(0, 16));
        const p2 = decipher.final();
        fileKey = Buffer.concat([p1, p2]);
        wrapKey.fill(0);
        break;
      } catch {
        wrapKey.fill(0);
      }
    }

    if (!fileKey || fileKey.byteLength !== 16) {
      throw new Error(
        "Decryption failed: provided secret key does not match any recipient stanza.",
      );
    }

    const hmacKey = Buffer.from(
      crypto.hkdfSync("sha256", fileKey, Buffer.alloc(0), Buffer.from("header"), 32),
    );
    const expectedMac = crypto
      .createHmac("sha256", hmacKey)
      .update(header.headerWithoutMac, "utf8")
      .digest();
    if (
      expectedMac.byteLength !== header.headerMac.byteLength ||
      !crypto.timingSafeEqual(expectedMac, header.headerMac)
    ) {
      fileKey.fill(0);
      throw new Error(
        "Decryption failed: age header HMAC authentication failed (archive tampered).",
      );
    }

    if (stat.size < header.payloadOffset + 16 + AGE_STREAM_TAG_BYTES) {
      fileKey.fill(0);
      throw new Error("Decryption failed: truncated age STREAM payload.");
    }

    const streamNonce = Buffer.alloc(16);
    const nonceRead = fs.readSync(inFd, streamNonce, 0, 16, header.payloadOffset);
    if (nonceRead !== 16) {
      fileKey.fill(0);
      throw new Error("Decryption failed: missing STREAM nonce.");
    }

    const payloadKey = Buffer.from(
      crypto.hkdfSync("sha256", fileKey, streamNonce, Buffer.from("payload"), 32),
    );
    fileKey.fill(0);

    fs.mkdirSync(path.dirname(safeOutput), { recursive: true });
    outFd = fs.openSync(tempOutPath, "w", 0o600);
    const outHash = crypto.createHash("sha256");

    const maxCipherChunkLen = AGE_STREAM_CHUNK_BYTES + AGE_STREAM_TAG_BYTES;
    const readBuf = Buffer.allocUnsafe(maxCipherChunkLen);
    let pos = header.payloadOffset + 16;
    let chunkCounter = 0n;
    let sawFinal = false;

    while (pos < stat.size) {
      const remaining = stat.size - pos;
      if (remaining < AGE_STREAM_TAG_BYTES) {
        throw new Error("Decryption failed: truncated trailing STREAM chunk.");
      }
      const chunkLen = Math.min(maxCipherChunkLen, remaining);
      const bytesRead = fs.readSync(inFd, readBuf, 0, chunkLen, pos);
      if (bytesRead !== chunkLen) {
        throw new Error("Decryption failed: short read during STREAM chunk processing.");
      }
      pos += bytesRead;

      const isEof = pos === stat.size;
      const chunkSlice = readBuf.subarray(0, bytesRead);
      const ct = chunkSlice.subarray(0, chunkSlice.byteLength - AGE_STREAM_TAG_BYTES);
      const tag = chunkSlice.subarray(chunkSlice.byteLength - AGE_STREAM_TAG_BYTES);

      let plainChunk;
      try {
        const decipher = crypto.createDecipheriv(
          "chacha20-poly1305",
          payloadKey,
          buildStreamNonce(chunkCounter, isEof),
        );
        decipher.setAuthTag(tag);
        plainChunk = Buffer.concat([decipher.update(ct), decipher.final()]);
      } catch {
        throw new Error(
          `Decryption failed: corrupted or tampered payload chunk #${chunkCounter.toString()}.`,
        );
      }

      if (isEof) {
        if (plainChunk.byteLength === 0 && chunkCounter > 0n) {
          throw new Error("Decryption failed: non-canonical empty final STREAM chunk.");
        }
        sawFinal = true;
      }

      if (plainChunk.byteLength > 0) {
        outHash.update(plainChunk);
        fs.writeSync(outFd, plainChunk, 0, plainChunk.byteLength);
      }
      chunkCounter += 1n;
    }

    payloadKey.fill(0);
    if (!sawFinal) {
      throw new Error("Decryption failed: missing STREAM final chunk.");
    }

    fs.closeSync(outFd);
    outFd = null;
    fs.closeSync(inFd);
    inFd = null;

    fs.renameSync(tempOutPath, safeOutput);
    const outStat = fs.statSync(safeOutput);
    return {
      outputPath: safeOutput,
      plaintextBytes: outStat.size,
      plaintextSha256: outHash.digest("hex"),
    };
  } catch (err) {
    if (outFd !== null) {
      try {
        fs.closeSync(outFd);
      } catch {}
    }
    if (inFd !== null) {
      try {
        fs.closeSync(inFd);
      } catch {}
    }
    try {
      if (fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
    } catch {}
    throw err;
  }
}

/** Gzip-compresses a file cleanly and returns compressed SHA-256 + sizes. */
export async function gzipFileDeterministic(inputPath, outputPath) {
  const safeIn = assertSafeBackupFilePath(inputPath, "gzip input");
  const safeOut = assertSafeBackupFilePath(outputPath, "gzip output");
  fs.mkdirSync(path.dirname(safeOut), { recursive: true });
  await pipeline(
    fs.createReadStream(safeIn),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(safeOut, { mode: 0o600 }),
  );
  const stat = fs.statSync(safeOut);
  const sha256 = await hashFileSha256(safeOut);
  return { byteSize: stat.size, sha256 };
}

/** Gunzip-decompresses a file cleanly and returns decompressed SHA-256 + size. */
export async function gunzipFile(inputPath, outputPath) {
  const safeIn = assertSafeBackupFilePath(inputPath, "gunzip input");
  const safeOut = assertSafeBackupFilePath(outputPath, "gunzip output");
  fs.mkdirSync(path.dirname(safeOut), { recursive: true });
  await pipeline(
    fs.createReadStream(safeIn),
    zlib.createGunzip(),
    fs.createWriteStream(safeOut, { mode: 0o600 }),
  );
  const stat = fs.statSync(safeOut);
  const sha256 = await hashFileSha256(safeOut);
  return { byteSize: stat.size, sha256 };
}

/** Computes SHA-256 hex digest of a file using streaming I/O. */
export async function hashFileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Evaluates freshness, structural header integrity, companion metadata, and SHA-256 consistency
 * of encrypted backups in `backupDir` so missing/stale/corrupted off-site backups fail loudly.
 */
export async function evaluateEncryptedBackupHealth({
  backupDir,
  now = new Date(),
  maxAgeHours = 26,
}) {
  const safeDir = assertSafeBackupFilePath(backupDir, "backup watchdog directory");
  if (!fs.existsSync(safeDir)) {
    return {
      ok: false,
      code: "backup_missing",
      reason: "Backup directory does not exist.",
      archiveCount: 0,
      latestArchive: null,
    };
  }

  const entries = fs.readdirSync(safeDir);
  const archives = entries
    .filter((f) => f.endsWith(".sql.gz.age"))
    .map((f) => {
      const fullPath = path.join(safeDir, f);
      const stat = fs.statSync(fullPath);
      return { name: f, fullPath, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (archives.length === 0) {
    return {
      ok: false,
      code: "backup_missing",
      reason: "No encrypted `.sql.gz.age` backup archives found.",
      archiveCount: 0,
      latestArchive: null,
    };
  }

  const latest = archives[0];
  const ageHours = Number(((now.getTime() - latest.mtimeMs) / 3_600_000).toFixed(2));
  if (latest.size < 128) {
    return {
      ok: false,
      code: "backup_corrupted",
      reason: `Latest backup archive ${latest.name} is implausibly small (${latest.size} bytes).`,
      archiveCount: archives.length,
      latestArchive: { name: latest.name, byteSize: latest.size, ageHours },
    };
  }

  let fd = null;
  try {
    fd = fs.openSync(latest.fullPath, "r");
    readAndParseAgeHeader(fd);
  } catch (err) {
    return {
      ok: false,
      code: "backup_corrupted",
      reason: err instanceof Error ? err.message : "Invalid age archive header.",
      archiveCount: archives.length,
      latestArchive: { name: latest.name, byteSize: latest.size, ageHours },
    };
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  const metaPath = `${latest.fullPath}.meta.json`;
  let companionVerified = false;
  let manifestAgeHours = ageHours;
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const actualSha256 = await hashFileSha256(latest.fullPath);
      if (meta.encryptedSha256 && meta.encryptedSha256 !== actualSha256) {
        return {
          ok: false,
          code: "manifest_mismatch",
          reason: `SHA-256 mismatch on ${latest.name}: expected ${meta.encryptedSha256}, got ${actualSha256}.`,
          archiveCount: archives.length,
          latestArchive: { name: latest.name, byteSize: latest.size, ageHours },
        };
      }
      if (typeof meta.createdAtUtc === "string") {
        const parsedMs = Date.parse(meta.createdAtUtc);
        if (Number.isFinite(parsedMs)) {
          manifestAgeHours = Number(((now.getTime() - parsedMs) / 3_600_000).toFixed(2));
        }
      }
      companionVerified = true;
    } catch {
      return {
        ok: false,
        code: "backup_corrupted",
        reason: `Companion metadata ${path.basename(metaPath)} is malformed.`,
        archiveCount: archives.length,
        latestArchive: { name: latest.name, byteSize: latest.size, ageHours },
      };
    }
  }

  const effectiveAgeHours = Math.max(ageHours, manifestAgeHours);
  if (effectiveAgeHours > maxAgeHours) {
    return {
      ok: false,
      code: "backup_stale",
      reason: `Latest encrypted backup ${latest.name} is stale (${effectiveAgeHours}h old; max ${maxAgeHours}h).`,
      archiveCount: archives.length,
      latestArchive: {
        name: latest.name,
        byteSize: latest.size,
        ageHours: effectiveAgeHours,
        companionVerified,
      },
    };
  }

  return {
    ok: true,
    code: "backup_healthy",
    reason: "Latest encrypted backup is present, authenticated, and within freshness SLA.",
    archiveCount: archives.length,
    latestArchive: {
      name: latest.name,
      byteSize: latest.size,
      ageHours: effectiveAgeHours,
      companionVerified,
    },
  };
}
