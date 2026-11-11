export const HOSTINGER_CRON_MAX_CMD_LEN: number;
export const IST_OFFSET_MS: number;

export function toIstPartsJs(date?: Date): {
  istDate: string;
  istTime: string;
  istDateTime: string;
}

export function toMysqlUtcDateTimeJs(date?: Date): string;

export function buildHostingerCliCommand(params: {
  username: string;
  domain: string;
  nodeMajor?: string;
  scriptRelPath?: string;
  args?: string[];
}): {
  compactCommand: string;
  compactLength: number;
  fitsHostinger255Limit: boolean;
  naiveAbsoluteCommand: string;
  naiveAbsoluteLength: number;
  naiveFitsHostinger255Limit: boolean;
}

export function parseCronCliArgs(argv: string[]): {
  help: boolean;
  printCommand: boolean;
  dryRun: boolean;
  executeDisposable: boolean;
  ownerId: string | null;
  bucketMinutes: number;
  maxRuntimeMs: number;
  domain: string;
  username: string;
}
