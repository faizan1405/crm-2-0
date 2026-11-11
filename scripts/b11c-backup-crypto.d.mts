export const AGE_V1_HEADER_LINE: string;
export const AGE_STREAM_CHUNK_BYTES: number;
export const AGE_STREAM_TAG_BYTES: number;
export const AGE_PUBLIC_KEY_RE: RegExp;
export const AGE_SECRET_KEY_RE: RegExp;

export function bech32Encode(hrp: string, dataBytes: Uint8Array, uppercase?: boolean): string;
export function bech32Decode(str: string): { hrp: string; bytes: Buffer };

export function assertSafeBackupFilePath(filePath: string, label?: string): string;
export function assertBackupProducerEnvHasNoPrivateKey(
  env?: Record<string, string | undefined>,
): void;

export function generateAgeX25519KeyPair(): {
  publicKey: string;
  secretKey: string;
  publicKeyFingerprintSha256: string;
};

export function parseAgePublicKey(publicKey: string): {
  recipient: string;
  rawPublicKey: Buffer;
  keyObject: unknown;
};

export function parseAgeSecretKey(secretKey: string): {
  rawSecretKey: Buffer;
  rawPublicKey: Buffer;
  publicKey: string;
  privateKeyObject: unknown;
};

export function encryptFileWithAgeX25519(params: {
  inputPath: string;
  outputPath: string;
  recipientPublicKey: string;
}): Promise<{
  outputPath: string;
  plaintextBytes: number;
  encryptedBytes: number;
  encryptedSha256: string;
  recipientPublicKey: string;
}>;

export function decryptFileWithAgeX25519(params: {
  inputPath: string;
  outputPath: string;
  secretKey: string;
}): Promise<{
  outputPath: string;
  plaintextBytes: number;
  plaintextSha256: string;
}>;

export function gzipFileDeterministic(
  inputPath: string,
  outputPath: string,
): Promise<{ byteSize: number; sha256: string }>;

export function gunzipFile(
  inputPath: string,
  outputPath: string,
): Promise<{ byteSize: number; sha256: string }>;

export function hashFileSha256(filePath: string): Promise<string>;

export function evaluateEncryptedBackupHealth(params: {
  backupDir: string;
  now?: Date;
  maxAgeHours?: number;
}): Promise<{
  ok: boolean;
  code:
    | "backup_healthy"
    | "backup_missing"
    | "backup_stale"
    | "backup_corrupted"
    | "manifest_mismatch";
  reason: string;
  archiveCount: number;
  latestArchive: {
    name: string;
    byteSize: number;
    ageHours: number;
    companionVerified?: boolean;
  } | null;
}>;
