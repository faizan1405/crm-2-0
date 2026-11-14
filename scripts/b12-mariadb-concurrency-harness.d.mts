export const MARIADB_CAPACITY_LOCK_NAME: string;

export function assertSafeDisposableDatabase(databaseName: unknown): string;

export interface AdvisoryLockProbeResult {
  workerId: string;
  ok: boolean;
  acquired: boolean;
  logEvents: Array<{
    workerId: string;
    event: string;
    acquired?: boolean;
    released?: boolean;
    latencyMs?: number;
    timestamp: string;
  }>;
}

export function executeAdvisoryLockProbe(params: {
  connectionConfig: {
    host: string;
    port?: number;
    database: string;
    user: string;
    password?: string;
  };
  lockName?: string;
  timeoutSeconds?: number;
  holdDurationMs?: number;
  workerId?: string;
}): Promise<AdvisoryLockProbeResult>;

export function runMultiProcessAdvisoryLockContention(params: {
  connectionConfig: {
    host: string;
    port?: number;
    database: string;
    user: string;
    password?: string;
  };
  workerCount?: number;
  timeoutSeconds?: number;
  holdDurationMs?: number;
  scriptPath?: string;
}): Promise<Array<{
  workerId: string;
  code: number;
  parsed?: AdvisoryLockProbeResult;
  rawOutput?: string;
  stderr?: string;
}>>;
