import "@tanstack/react-start/server-only";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { verifyDisposableAutomationTestDatabaseConfig, type ServerEnv } from "../config/env.server";
import type { CrmDatabase } from "../db/index.server";
import { crmAutomationRules, crmFollowUps, crmLeads, crmUsers } from "../db/schema.server";
import { toMysqlUtcDateTime } from "../db/utc.server";
import {
  type ActionType,
  type RuleConditions,
  type RuleSettings,
  type RuleSubject,
  type TriggerType,
} from "./automationCalc.server";
import { executeAutomationRuleRecord } from "./automationExecution.server";
import { simulateRuleExecution } from "./automationSimulation.server";
import { pad2, toIstParts } from "./dates.server";
import { CrmServiceError } from "./errors.server";

export const HOSTINGER_CRON_MAX_COMMAND_CHARS = 255;
export const HOSTINGER_CRON_MAX_TIMEOUT_MINUTES = 30;
export const HOSTINGER_CRON_DEFAULT_BUDGET_MS = 240_000; // 4m target safely inside 30m limit

export const CRON_SCHEDULED_TRIGGERS = ["followup_overdue", "inactivity"] as const;
export type CronScheduledTrigger = (typeof CRON_SCHEDULED_TRIGGERS)[number];

/** Strictly internal actions allowed in cron evaluation; never sends WhatsApp, email, SMS, or calls. */
export const CRON_INTERNAL_SAFE_ACTIONS: readonly ActionType[] = [
  "followup",
  "reminder",
  "flag",
  "owner_review",
  "activity",
] as const;

export interface CronWindowContext {
  nowUtcIso: string;
  nowUtcMysql: string;
  istDate: string;
  istTime: string;
  istDateTime: string;
  bucketMinutes: number;
  istBucketKey: string;
  utcBucketKey: string;
}

/**
 * Computes deterministic UTC and Asia/Kolkata (IST) schedule buckets from a UTC host clock
 * so Hostinger UTC cron schedules align accurately with Indian business deadlines.
 */
export function computeCronWindowContext(
  now: Date = new Date(),
  bucketMinutes: number = 15,
): CronWindowContext {
  const safeBucket = Math.max(1, Math.min(1440, Math.floor(bucketMinutes)));
  const bucketMs = safeBucket * 60_000;
  const flooredMs = Math.floor(now.getTime() / bucketMs) * bucketMs;
  const flooredDate = new Date(flooredMs);

  const nowIst = toIstParts(now);
  const bucketIst = toIstParts(flooredDate);
  const utcIso = flooredDate.toISOString();
  const utcBucketKey = `${utcIso.slice(0, 10)}T${utcIso.slice(11, 16)}Z`;
  const istBucketKey = `${bucketIst.istDate}T${bucketIst.istTime}+0530`;

  return {
    nowUtcIso: now.toISOString(),
    nowUtcMysql: toMysqlUtcDateTime(now),
    istDate: nowIst.istDate,
    istTime: nowIst.istTime,
    istDateTime: nowIst.istDateTime,
    bucketMinutes: safeBucket,
    istBucketKey,
    utcBucketKey,
  };
}

export interface HostingerCronCommandSpec {
  compactCommand: string;
  compactLength: number;
  fitsHostinger255Limit: boolean;
  naiveAbsoluteCommand: string;
  naiveAbsoluteLength: number;
  naiveFitsHostinger255Limit: boolean;
}

const SAFE_SHELL_TOKEN_RE = /^[A-Za-z0-9._/-]+$/;
const SAFE_CLI_FLAG_RE = /^--[A-Za-z0-9][A-Za-z0-9=_-]*$/;

/**
 * Builds and validates Hostinger cron command strings against Hostinger Business Web Hosting's
 * 255-character command length cap and `--env-file` `hbuilds` directory layout.
 */
export function buildHostingerCronCommand(params: {
  username: string;
  domain: string;
  nodeMajor?: "18" | "20" | "22" | "24" | undefined;
  scriptRelPath?: string | undefined;
  args?: readonly string[] | undefined;
}): HostingerCronCommandSpec {
  const username = params.username.trim();
  const domain = params.domain.trim();
  const nodeMajor = params.nodeMajor ?? "22";
  const scriptRelPath = (params.scriptRelPath ?? "server/run-cron.mjs").replace(/^\/+/, "");
  const args = (params.args ?? ["--dry-run"]).map((a) => a.trim()).filter(Boolean);

  if (!SAFE_SHELL_TOKEN_RE.test(username) || !SAFE_SHELL_TOKEN_RE.test(domain)) {
    throw new CrmServiceError(400, "validation_error", "Invalid Hostinger username or domain.");
  }
  if (!SAFE_SHELL_TOKEN_RE.test(scriptRelPath) || scriptRelPath.includes("..")) {
    throw new CrmServiceError(400, "validation_error", "Invalid relative cron script path.");
  }
  for (const arg of args) {
    if (!SAFE_CLI_FLAG_RE.test(arg)) {
      throw new CrmServiceError(400, "validation_error", `Unsafe cron CLI argument: ${arg}`);
    }
  }

  const hbuildsRoot = `/home/${username}/domains/${domain}/hbuilds`;
  const nodeBin = `/opt/alt/alt-nodejs${nodeMajor}/root/bin/node`;
  const argsSuffix = args.length > 0 ? ` ${args.join(" ")}` : "";

  const compactCommand = `cd ${hbuildsRoot} && ${nodeBin} --env-file=config/.env current/nodejs/${scriptRelPath}${argsSuffix}`;
  const naiveAbsoluteCommand = `${nodeBin} --env-file=${hbuildsRoot}/config/.env ${hbuildsRoot}/current/nodejs/${scriptRelPath}${argsSuffix}`;

  return {
    compactCommand,
    compactLength: compactCommand.length,
    fitsHostinger255Limit: compactCommand.length <= HOSTINGER_CRON_MAX_COMMAND_CHARS,
    naiveAbsoluteCommand,
    naiveAbsoluteLength: naiveAbsoluteCommand.length,
    naiveFitsHostinger255Limit: naiveAbsoluteCommand.length <= HOSTINGER_CRON_MAX_COMMAND_CHARS,
  };
}

export function isCronActionSafeInternalOnly(action: ActionType): boolean {
  return (CRON_INTERNAL_SAFE_ACTIONS as readonly string[]).includes(action);
}

export interface AutomationCronTickOptions {
  ownerUserId?: string | undefined;
  now?: Date | undefined;
  dryRun?: boolean | undefined;
  allowExecution?: boolean | undefined;
  allowTestExecutionInMock?: boolean | undefined;
  env?: ServerEnv | undefined;
  liveDatabaseName?: string | null | undefined;
  bucketMinutes?: number | undefined;
  maxRulesPerRun?: number | undefined;
  maxTargetsPerRule?: number | undefined;
  maxRuntimeMs?: number | undefined;
  /** Simulated clock helper for bounded-runtime & crash tests. */
  getElapsedMs?: (() => number) | undefined;
  acquireLock?: ((lockName: string) => Promise<boolean>) | undefined;
  releaseLock?: ((lockName: string) => Promise<void>) | undefined;
}

export interface CronRuleRunSummary {
  ruleId: string;
  ruleName: string;
  triggerType: CronScheduledTrigger;
  checkedTargets: number;
  matchedTargets: number;
  createdFollowUps: number;
  createdReminders: number;
  skippedDuplicates: number;
  skippedActiveFollowUp: number;
  outboundBlockedCount: number;
  failedTargets: number;
}

export interface AutomationCronTickReport {
  ok: true;
  mode: "dry_run" | "disposable_execution";
  lockName: string;
  lockAcquired: boolean;
  window: CronWindowContext;
  startedAtUtc: string;
  finishedAtUtc: string;
  durationMs: number;
  stoppedEarlyByBudget: boolean;
  checkedOwners: number;
  checkedRules: number;
  checkedTargets: number;
  matchedTargets: number;
  createdFollowUps: number;
  createdReminders: number;
  skippedDuplicates: number;
  skippedActiveFollowUp: number;
  outboundBlockedCount: number;
  failedTargets: number;
  outboundDeliveryGuaranteedDisabled: true;
  ruleSummaries: CronRuleRunSummary[];
  warnings: string[];
}

async function defaultAcquireMysqlLock(db: CrmDatabase, lockName: string): Promise<boolean> {
  if (typeof (db as { execute?: unknown }).execute !== "function") {
    return true;
  }
  const res = await db.execute(sql`SELECT GET_LOCK(${lockName}, 0) AS acquired`);
  const rowContainer = Array.isArray(res) ? res[0] : res;
  const firstRow = Array.isArray(rowContainer) ? rowContainer[0] : rowContainer;
  if (firstRow && typeof firstRow === "object" && "acquired" in firstRow) {
    return Number((firstRow as { acquired: unknown }).acquired) === 1;
  }
  return true;
}

async function defaultReleaseMysqlLock(db: CrmDatabase, lockName: string): Promise<void> {
  if (typeof (db as { execute?: unknown }).execute !== "function") {
    return;
  }
  await db.execute(sql`SELECT RELEASE_LOCK(${lockName}) AS released`);
}

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function buildDeterministicCronEventId(params: {
  triggerType: CronScheduledTrigger;
  ruleId: string;
  ruleVersion: number;
  targetId: string;
  istBucketKey: string;
}): string {
  const bucketClean = params.istBucketKey.replace(/[^A-Za-z0-9]/g, "").slice(0, 16);
  const raw = `cron_${params.triggerType}_${params.ruleId}_v${params.ruleVersion}_${params.targetId}_${bucketClean}`;
  return raw.slice(0, 128);
}

/**
 * Short-lived Hostinger-compatible scheduled tick for Follow-ups (`followup_overdue`, `inactivity`)
 * and Internal Reminders. Designed to run and exit cleanly in seconds (never a 24/7 daemon),
 * fail-closed against production execution, lock against overlaps, and guarantee zero duplicate Follow-ups.
 */
export async function runAutomationCronTick(
  db: CrmDatabase,
  options: AutomationCronTickOptions = {},
): Promise<AutomationCronTickReport> {
  const startWallMs = Date.now();
  const now = options.now ?? new Date();
  const bucketMinutes = options.bucketMinutes ?? 15;
  const window = computeCronWindowContext(now, bucketMinutes);
  const dryRun = options.dryRun ?? true;
  const maxRules = Math.max(1, Math.min(200, options.maxRulesPerRun ?? 50));
  const maxTargets = Math.max(1, Math.min(500, options.maxTargetsPerRule ?? 100));
  const maxRuntimeMs = Math.max(
    50,
    Math.min(1_500_000, options.maxRuntimeMs ?? HOSTINGER_CRON_DEFAULT_BUDGET_MS),
  );
  const getElapsed = options.getElapsedMs ?? (() => Date.now() - startWallMs);

  // Strict fail-closed safety gate: production writes via cron remain DISABLED.
  if (!dryRun) {
    if (!options.allowExecution) {
      throw new CrmServiceError(
        403,
        "automation_validation_error",
        "Non-dry-run cron execution requires explicit allowExecution authorization.",
      );
    }
    if (options.env?.NODE_ENV === "production" || process.env["NODE_ENV"] === "production") {
      throw new CrmServiceError(
        403,
        "automation_validation_error",
        "Unattended cron mutations are strictly disabled in production mode (use --dry-run).",
      );
    }
    if (!options.allowTestExecutionInMock) {
      if (!options.env) {
        throw new CrmServiceError(
          403,
          "automation_validation_error",
          "Cron execution requires validated ServerEnv + AUTOMATION_TEST_DB_ALLOWLIST.",
        );
      }
      const guard = verifyDisposableAutomationTestDatabaseConfig(
        options.env,
        options.liveDatabaseName,
      );
      if (!guard.ok) {
        throw new CrmServiceError(403, "automation_validation_error", guard.message);
      }
    }
  }

  const lockSuffix = options.ownerUserId ? options.ownerUserId.slice(0, 24) : "all";
  const lockName = `sf_crm_cron_${lockSuffix}`;
  const lockAcquired = options.acquireLock
    ? await options.acquireLock(lockName)
    : await defaultAcquireMysqlLock(db, lockName);

  const reportBase = {
    ok: true as const,
    mode: dryRun ? ("dry_run" as const) : ("disposable_execution" as const),
    lockName,
    lockAcquired,
    window,
    startedAtUtc: now.toISOString(),
    outboundDeliveryGuaranteedDisabled: true as const,
  };

  if (!lockAcquired) {
    const endDate = new Date();
    return {
      ...reportBase,
      finishedAtUtc: endDate.toISOString(),
      durationMs: Math.max(0, getElapsed()),
      stoppedEarlyByBudget: false,
      checkedOwners: 0,
      checkedRules: 0,
      checkedTargets: 0,
      matchedTargets: 0,
      createdFollowUps: 0,
      createdReminders: 0,
      skippedDuplicates: 0,
      skippedActiveFollowUp: 0,
      outboundBlockedCount: 0,
      failedTargets: 0,
      ruleSummaries: [],
      warnings: ["Skipped tick because another cron instance holds advisory lock."],
    };
  }

  let stoppedEarlyByBudget = false;
  let checkedOwners = 0;
  let checkedRules = 0;
  let checkedTargets = 0;
  let matchedTargets = 0;
  let createdFollowUps = 0;
  let createdReminders = 0;
  let skippedDuplicates = 0;
  let skippedActiveFollowUp = 0;
  let outboundBlockedCount = 0;
  let failedTargets = 0;
  const ruleSummaries: CronRuleRunSummary[] = [];
  const warnings: string[] = [];

  try {
    const ownerIds: string[] = options.ownerUserId
      ? [options.ownerUserId]
      : (
          await db
            .select({ id: crmUsers.id })
            .from(crmUsers)
            .where(eq(crmUsers.accountStatus, "active"))
            .limit(20)
        ).map((u) => u.id);

    for (const ownerUserId of ownerIds) {
      if (getElapsed() >= maxRuntimeMs) {
        stoppedEarlyByBudget = true;
        warnings.push("Stopped cleanly on runtime budget before next owner.");
        break;
      }
      checkedOwners++;

      const rules = await db
        .select()
        .from(crmAutomationRules)
        .where(
          and(
            eq(crmAutomationRules.ownerUserId, ownerUserId),
            eq(crmAutomationRules.status, "enabled"),
          ),
        )
        .orderBy(asc(crmAutomationRules.createdAt))
        .limit(maxRules);

      for (const rule of rules) {
        if (getElapsed() >= maxRuntimeMs) {
          stoppedEarlyByBudget = true;
          warnings.push("Stopped cleanly on runtime budget before next rule.");
          break;
        }
        if (rule.triggerType !== "followup_overdue" && rule.triggerType !== "inactivity") {
          continue;
        }

        const triggerType = rule.triggerType as CronScheduledTrigger;
        checkedRules++;

        const parsedActions = parseJsonSafe<ActionType[]>(rule.actionsJson, []);
        const blockedExternal = parsedActions.filter((a) => !isCronActionSafeInternalOnly(a));
        const safeActions = parsedActions.filter((a) => isCronActionSafeInternalOnly(a));

        const summary: CronRuleRunSummary = {
          ruleId: rule.id,
          ruleName: rule.name,
          triggerType,
          checkedTargets: 0,
          matchedTargets: 0,
          createdFollowUps: 0,
          createdReminders: 0,
          skippedDuplicates: 0,
          skippedActiveFollowUp: 0,
          outboundBlockedCount: blockedExternal.length,
          failedTargets: 0,
        };
        outboundBlockedCount += blockedExternal.length;

        const parsedConditions = parseJsonSafe<RuleConditions>(rule.conditionsJson, {});
        const parsedSettings = parseJsonSafe<RuleSettings>(rule.settingsJson, {
          cooldownHours: 24,
        });

        if (safeActions.length === 0) {
          ruleSummaries.push(summary);
          continue;
        }

        if (triggerType === "followup_overdue") {
          const overdueRows = await db
            .select({
              followUpId: crmFollowUps.id,
              leadId: crmFollowUps.leadId,
              dueAt: crmFollowUps.dueAt,
              dueIstDate: crmFollowUps.dueIstDate,
              dueIstTime: crmFollowUps.dueIstTime,
            })
            .from(crmFollowUps)
            .where(
              and(
                eq(crmFollowUps.ownerUserId, ownerUserId),
                isNull(crmFollowUps.completedAt),
                isNull(crmFollowUps.cancelledAt),
                lte(crmFollowUps.dueAt, window.nowUtcMysql),
              ),
            )
            .orderBy(asc(crmFollowUps.dueAt))
            .limit(maxTargets);

          for (const fu of overdueRows) {
            if (getElapsed() >= maxRuntimeMs) {
              stoppedEarlyByBudget = true;
              warnings.push("Stopped cleanly on runtime budget inside overdue follow-up scan.");
              break;
            }
            summary.checkedTargets++;
            checkedTargets++;

            const eventId = buildDeterministicCronEventId({
              triggerType: "followup_overdue",
              ruleId: rule.id,
              ruleVersion: rule.version,
              targetId: fu.followUpId,
              istBucketKey: window.istBucketKey,
            });

            if (dryRun) {
              const sim = await simulateRuleExecution(
                db as unknown as Parameters<typeof simulateRuleExecution>[0],
                ownerUserId,
                {
                  id: rule.id,
                  name: rule.name,
                  subject: rule.subject as RuleSubject,
                  triggerType,
                  conditions: parsedConditions,
                  actions: safeActions,
                  settings: parsedSettings,
                },
                {
                  eventId,
                  triggerType: "followup_overdue",
                  leadId: fu.leadId,
                  followupId: fu.followUpId,
                  at: now.toISOString(),
                },
              );
              if (sim.matched) {
                summary.matchedTargets++;
                matchedTargets++;
              }
              continue;
            }

            try {
              const execRes = await executeAutomationRuleRecord(
                db,
                ownerUserId,
                ownerUserId,
                rule.id,
                {
                  expectedVersion: rule.version,
                  authorized: true,
                  depth: 0,
                  event: {
                    eventId,
                    triggerType: "followup_overdue",
                    leadId: fu.leadId,
                    followupId: fu.followUpId,
                    at: now.toISOString(),
                  },
                },
                { now, sourceEventId: eventId },
              );

              if (execRes.replayed) {
                summary.skippedDuplicates++;
                skippedDuplicates++;
                continue;
              }
              if (execRes.outcome === "succeeded") {
                summary.matchedTargets++;
                matchedTargets++;
              }
              for (const act of execRes.executedActions) {
                if (act.action === "followup" && act.status === "succeeded") {
                  summary.createdFollowUps++;
                  createdFollowUps++;
                } else if (act.action === "reminder" && act.status === "succeeded") {
                  summary.createdReminders++;
                  createdReminders++;
                } else if (act.status === "skipped") {
                  if (act.reason?.includes("active pending follow-up")) {
                    summary.skippedActiveFollowUp++;
                    skippedActiveFollowUp++;
                  } else {
                    summary.skippedDuplicates++;
                    skippedDuplicates++;
                  }
                }
              }
            } catch (err) {
              summary.failedTargets++;
              failedTargets++;
              warnings.push(
                `Rule ${rule.id} failed for followup ${fu.followUpId}: ${err instanceof Error ? err.message : "unknown"}`,
              );
            }
          }
        } else if (triggerType === "inactivity") {
          const leads = await db
            .select({ id: crmLeads.id })
            .from(crmLeads)
            .where(
              and(eq(crmLeads.ownerUserId, ownerUserId), eq(crmLeads.lifecycleStatus, "active")),
            )
            .orderBy(asc(crmLeads.updatedAt))
            .limit(maxTargets);

          for (const lead of leads) {
            if (getElapsed() >= maxRuntimeMs) {
              stoppedEarlyByBudget = true;
              warnings.push("Stopped cleanly on runtime budget inside inactivity scan.");
              break;
            }
            summary.checkedTargets++;
            checkedTargets++;

            const eventId = buildDeterministicCronEventId({
              triggerType: "inactivity",
              ruleId: rule.id,
              ruleVersion: rule.version,
              targetId: lead.id,
              istBucketKey: window.istBucketKey,
            });

            if (dryRun) {
              const sim = await simulateRuleExecution(
                db as unknown as Parameters<typeof simulateRuleExecution>[0],
                ownerUserId,
                {
                  id: rule.id,
                  name: rule.name,
                  subject: rule.subject as RuleSubject,
                  triggerType,
                  conditions: parsedConditions,
                  actions: safeActions,
                  settings: parsedSettings,
                },
                {
                  eventId,
                  triggerType: "inactivity",
                  leadId: lead.id,
                  at: now.toISOString(),
                },
              );
              if (sim.matched) {
                summary.matchedTargets++;
                matchedTargets++;
              }
              continue;
            }

            try {
              const execRes = await executeAutomationRuleRecord(
                db,
                ownerUserId,
                ownerUserId,
                rule.id,
                {
                  expectedVersion: rule.version,
                  authorized: true,
                  depth: 0,
                  event: {
                    eventId,
                    triggerType: "inactivity",
                    leadId: lead.id,
                    at: now.toISOString(),
                  },
                },
                { now, sourceEventId: eventId },
              );

              if (execRes.replayed) {
                summary.skippedDuplicates++;
                skippedDuplicates++;
                continue;
              }
              if (execRes.outcome === "succeeded") {
                summary.matchedTargets++;
                matchedTargets++;
              }
              for (const act of execRes.executedActions) {
                if (act.action === "followup" && act.status === "succeeded") {
                  summary.createdFollowUps++;
                  createdFollowUps++;
                } else if (act.action === "reminder" && act.status === "succeeded") {
                  summary.createdReminders++;
                  createdReminders++;
                } else if (act.status === "skipped") {
                  if (act.reason?.includes("active pending follow-up")) {
                    summary.skippedActiveFollowUp++;
                    skippedActiveFollowUp++;
                  } else {
                    summary.skippedDuplicates++;
                    skippedDuplicates++;
                  }
                }
              }
            } catch (err) {
              summary.failedTargets++;
              failedTargets++;
              warnings.push(
                `Rule ${rule.id} failed for lead ${lead.id}: ${err instanceof Error ? err.message : "unknown"}`,
              );
            }
          }
        }

        ruleSummaries.push(summary);
        if (stoppedEarlyByBudget) break;
      }
    }
  } finally {
    if (options.releaseLock) {
      await options.releaseLock(lockName).catch(() => undefined);
    } else {
      await defaultReleaseMysqlLock(db, lockName).catch(() => undefined);
    }
  }

  const endDate = new Date();
  return {
    ...reportBase,
    finishedAtUtc: endDate.toISOString(),
    durationMs: Math.max(0, getElapsed()),
    stoppedEarlyByBudget,
    checkedOwners,
    checkedRules,
    checkedTargets,
    matchedTargets,
    createdFollowUps,
    createdReminders,
    skippedDuplicates,
    skippedActiveFollowUp,
    outboundBlockedCount,
    failedTargets,
    ruleSummaries,
    warnings,
  };
}

export function formatUtcOffsetLabel(date: Date = new Date()): string {
  const ist = toIstParts(date);
  return `${ist.istDate} ${ist.istTime} IST (${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC)`;
}
