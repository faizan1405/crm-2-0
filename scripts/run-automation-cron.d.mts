export const HOSTINGER_CRON_MAX_CMD_LEN: number;
export const IST_OFFSET_MS: number;

export function toIstPartsJs(date?: Date): {
  istDate: string;
  istTime: string;
  istDateTime: string;
};

export function computeCronBucketsJs(
  date?: Date,
  bucketMinutes?: number,
): {
  utcBucketKey: string;
  istBucketKey: string;
  bucketMinutes: number;
};

export function toMysqlUtcDateTimeJs(date?: Date): string;

export function buildHostingerCliCommand(params: {
  username: string;
  domain: string;
  nodeMajor?: string;
  scriptRelPath?: string;
  args?: string[];
}): {
  command: string;
  length: number;
  headroomChars: number;
  nodeBinary: string;
  usesShellOperators: boolean;
  autoDiscoversEnv: boolean;
  compactCommand: string;
  compactLength: number;
  fitsHostinger255Limit: boolean;
  naiveAbsoluteCommand: string;
  naiveAbsoluteLength: number;
  naiveFitsHostinger255Limit: boolean;
};

export function assessEnvStatSecurity(
  lstat: {
    mode: number;
    uid?: number;
    isSymbolicLink?: () => boolean;
    isFile?: () => boolean;
  },
  envPath: string,
  runtime?: {
    platform: string;
    currentUid?: number | null;
  },
): { ok: true } | { ok: false; code: "env_file_untrusted"; message: string };

export function parseDotEnvSafely(content: string): Record<string, string>;

export function resolveCronEnvCandidates(options?: {
  scriptFilePath?: string;
  explicitEnvPath?: string | null;
  cwd?: string;
}): string[];

export function resolveAndLoadCronEnv(options?: {
  scriptFilePath?: string;
  explicitEnvPath?: string | null;
  cwd?: string;
  targetEnv?: Record<string, string | undefined>;
  requireEnvFile?: boolean;
}): {
  loaded: boolean;
  source: "explicit_env_file" | "auto_discovered_env_file" | "process_env_only";
  envPath: string | null;
  keyCount: number;
  appliedKeyCount: number;
};

export function parseCronCliArgs(argv: string[]): {
  help: boolean;
  printCommand: boolean;
  verifyConfig: boolean;
  dryRun: boolean;
  executeDisposable: boolean;
  ownerId: string | null;
  bucketMinutes: number;
  maxRuntimeMs: number;
  domain: string;
  username: string;
  envFile: string | null;
};
