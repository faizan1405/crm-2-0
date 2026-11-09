import "@tanstack/react-start/server-only";
import crypto from "node:crypto";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export const SCRYPT_PARAMS = {
  N: 32_768,
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 64 * 1024 * 1024,
  saltBytes: 16,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Static dummy scrypt hash used when an unknown/disabled email is attempted so CPU timing
// matches a real scrypt verification pass without extra startup hashing delay.
const DUMMY_SCRYPT_HASH =
  "scrypt$N=32768,r=8,p=1$AAECAwQFBgcICQoLDA0ODw$AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PA";

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidAccountEmail(email: string): boolean {
  const normalized = normalizeAccountEmail(email);
  return normalized.length > 0 && normalized.length <= 160 && EMAIL_PATTERN.test(normalized);
}

/**
 * Password complexity check aligned with `src/lib/crm/team.ts` (`PASSWORD_MIN..PASSWORD_MAX`,
 * at least one ASCII letter + one digit, no leading/trailing spaces). Used at creation/bootstrap.
 */
export function validatePasswordPolicy(password: string): string | null {
  if (typeof password !== "string" || password.length === 0) {
    return "Enter a password.";
  }
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters.`;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  if (/^\s|\s$/.test(password)) {
    return "Password can't start or end with a space.";
  }
  return null;
}

/** Login-time length guard to avoid hashing arbitrary multi-megabyte inputs. */
export function validateLoginPasswordInput(password: unknown): password is string {
  return typeof password === "string" && password.length >= 1 && password.length <= PASSWORD_MAX;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const policyError = validatePasswordPolicy(password);
  if (policyError) {
    throw new Error(policyError);
  }

  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltBytes);
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });

  return `scrypt$N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

interface ParsedScryptHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  expected: Buffer;
}

function parseScryptHash(encoded: string): ParsedScryptHash | null {
  if (!encoded || typeof encoded !== "string") return null;
  const parts = encoded.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return null;

  const paramMatch = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[1] ?? "");
  if (!paramMatch) return null;

  const N = Number(paramMatch[1]);
  const r = Number(paramMatch[2]);
  const p = Number(paramMatch[3]);
  if (
    !Number.isSafeInteger(N) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    N < 16_384 ||
    N > 131_072 ||
    (N & (N - 1)) !== 0 ||
    r < 4 ||
    r > 16 ||
    p < 1 ||
    p > 4
  ) {
    return null;
  }

  const saltStr = parts[2] ?? "";
  const hashStr = parts[3] ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(saltStr) || !/^[A-Za-z0-9_-]{43,128}$/.test(hashStr)) {
    return null;
  }

  const salt = Buffer.from(saltStr, "base64url");
  const expected = Buffer.from(hashStr, "base64url");
  if (salt.length < 16 || expected.length < 32 || expected.length > 64) {
    return null;
  }

  return { N, r, p, salt, expected };
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (!validateLoginPasswordInput(password)) return false;
  const parsed = parseScryptHash(encodedHash);
  if (!parsed) return false;

  try {
    const derived = await scryptAsync(password, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    if (derived.length !== parsed.expected.length) return false;
    return crypto.timingSafeEqual(derived, parsed.expected);
  } catch {
    return false;
  }
}

/** Spends equivalent scrypt verification time when no active Owner account matches the email. */
export async function verifyDummyPassword(password: string): Promise<void> {
  const safeInput = validateLoginPasswordInput(password) ? password : "DummyVerificationFallback1";
  await verifyPassword(safeInput, DUMMY_SCRYPT_HASH);
}
