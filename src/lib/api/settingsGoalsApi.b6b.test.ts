import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSettingsDiffPayload,
  clientValidateSettingsDraft,
  clientValidateSettingsField,
  dtoToSettingsDraft,
  normalizeNullableTextInput,
  settingsKeys,
  updateOwnerSettings,
} from "./settingsApi";
import {
  createGoal,
  formatGoalMetricValue,
  formatGoalProgressPercent,
  formatInrFromDecimalString,
  goalsKeys,
  parseGoalTargetInput,
} from "./goalsApi";
import {
  goalsProgressListResponseSchema,
  ownerSettingsDtoSchema,
  ownerSettingsGetResponseSchema,
  type OwnerSettingsDto,
} from "./schemas";

const BASE_SETTINGS: OwnerSettingsDto = {
  configured: false,
  id: null,
  ownerUserId: "usr_owner_a",
  ownerDisplayName: null,
  businessName: null,
  profileEmail: null,
  businessPhone: null,
  businessWebsite: null,
  businessAddress: null,
  gstin: null,
  paymentInstructions: null,
  businessTimezone: "Asia/Kolkata",
  currencyCode: "INR",
  defaultLeadSort: "recent",
  notifyFollowUps: true,
  notifyPayments: true,
  notifyDigest: false,
  notifyGoalAchieved: true,
  notifyTeamGoal: true,
  notifyMilestone: false,
  notifyOverdue: true,
  overdueThreshold: 10,
  updatedByUserId: null,
  version: 0,
  createdAt: null,
  updatedAt: null,
};

describe("B6B settingsApi & goalsApi typed contracts and pure helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes empty nullable text to null and builds exact diffs", () => {
    expect(normalizeNullableTextInput("   ")).toBeNull();
    expect(normalizeNullableTextInput("  Studio  ")).toBe("Studio");
    expect(normalizeNullableTextInput(" line 1 \r\n line 2 ", { multiline: true })).toBe(
      "line 1 \n line 2",
    );

    const existing: OwnerSettingsDto = {
      ...BASE_SETTINGS,
      configured: true,
      id: "set_1",
      ownerDisplayName: "Aarav",
      businessName: "Scale Flow Studio",
      profileEmail: "aarav@scaleflow.in",
      gstin: "27ABCDE1234F1Z5",
      version: 3,
    };

    const draft = dtoToSettingsDraft(existing);
    expect(buildSettingsDiffPayload(existing, draft).hasChanges).toBe(false);

    draft.businessName = "   ";
    draft.profileEmail = "BILLING@SCALEFLOW.IN ";
    draft.gstin = "";
    draft.defaultLeadSort = "score";
    draft.notifyMilestone = true;
    draft.overdueThreshold = "25";

    const diff = buildSettingsDiffPayload(existing, draft);
    expect(diff.hasChanges).toBe(true);
    expect(diff.payload).toEqual({
      businessName: null,
      profileEmail: "billing@scaleflow.in",
      gstin: null,
      defaultLeadSort: "score",
      notifyMilestone: true,
      overdueThreshold: 25,
    });
  });

  it("validates business email, phone, website, GSTIN, and overdueThreshold strictly", () => {
    const draft = dtoToSettingsDraft(BASE_SETTINGS);
    draft.profileEmail = "not-an-email";
    draft.businessPhone = "123";
    draft.businessWebsite = "ftp://example.com";
    draft.gstin = "BADGSTIN";
    draft.overdueThreshold = "0";

    const errors = clientValidateSettingsDraft(draft);
    expect(errors["profileEmail"]).toMatch(/email/i);
    expect(errors["businessPhone"]).toMatch(/phone/i);
    expect(errors["businessWebsite"]).toMatch(/http/i);
    expect(errors["gstin"]).toMatch(/GSTIN/i);
    expect(errors["overdueThreshold"]).toMatch(/1 and 1000/i);

    draft.profileEmail = "owner@studio.in";
    draft.businessPhone = "+91 98765 43210";
    draft.businessWebsite = "https://studio.in";
    draft.gstin = "27abcde1234f1z5";
    draft.overdueThreshold = "15";

    expect(clientValidateSettingsField("gstin", draft)).toBeNull();
    expect(clientValidateSettingsDraft(draft)).toEqual({});
  });

  it("parses count & exact paise INR targets without float rounding or negative targets", () => {
    expect(parseGoalTargetInput("inr", "", true)).toEqual({
      ok: true,
      target: null,
      displayHint: null,
    });

    const emptyErr = parseGoalTargetInput("inr", "", false);
    expect(emptyErr.ok).toBe(false);

    const negErr = parseGoalTargetInput("inr", "-500", false);
    expect(negErr.ok).toBe(false);

    const zeroErr = parseGoalTargetInput("count", "0", false);
    expect(zeroErr.ok).toBe(false);

    const fracCountErr = parseGoalTargetInput("count", "12.5", false);
    expect(fracCountErr.ok).toBe(false);

    const inrPrecise = parseGoalTargetInput("inr", "20000.3", false);
    expect(inrPrecise).toEqual({
      ok: true,
      target: "20000.30",
      displayHint: "₹20,000.30",
    });

    const overTwoDecimals = parseGoalTargetInput("inr", "100.123", false);
    expect(overTwoDecimals.ok).toBe(false);

    expect(formatInrFromDecimalString("100000.50")).toBe("₹1,00,000.50");
    expect(formatInrFromDecimalString("100000.00")).toBe("₹1,00,000");
    expect(formatGoalMetricValue({ unit: "inr", value: 100000.5, decimal: "100000.50" })).toBe(
      "₹1,00,000.50",
    );
    expect(formatGoalMetricValue({ unit: "count", value: 42 })).toBe("42");

    expect(formatGoalProgressPercent(null)).toBe("N/A");
    expect(formatGoalProgressPercent(Number.NaN)).toBe("N/A");
    expect(formatGoalProgressPercent(62.54)).toBe("62.5%");
    expect(formatGoalProgressPercent(100)).toBe("100%");
  });

  it("validates settings and goal progress API envelopes with owner-isolated query keys", () => {
    const parsedGet = ownerSettingsGetResponseSchema.parse({
      ok: true,
      settings: ownerSettingsDtoSchema.parse(BASE_SETTINGS),
    });
    expect(parsedGet.settings.configured).toBe(false);

    const parsedProgress = goalsProgressListResponseSchema.parse({
      ok: true,
      asOfIstDate: "2026-11-10",
      status: "not_configured",
      note: "No goals configured",
      items: [],
    });
    expect(parsedProgress.items).toHaveLength(0);

    expect(settingsKeys.current("usr_a")).not.toEqual(settingsKeys.current("usr_b"));
    expect(goalsKeys.progressAll("usr_a", "2026-11-10")).not.toEqual(
      goalsKeys.progressAll("usr_b", "2026-11-10"),
    );

    const qc = new QueryClient();
    qc.setQueryData(settingsKeys.current("usr_a"), { ok: true, settings: BASE_SETTINGS });
    qc.setQueryData(goalsKeys.progressAll("usr_b", "2026-11-10"), { ok: true });
    expect(qc.getQueryData(settingsKeys.current("usr_b"))).toBeUndefined();
  });

  it("sends Idempotency-Key header and credentials on settings & goals mutations", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            changed: true,
            settings: { ...BASE_SETTINGS, configured: true, id: "set_1", version: 1 },
            auditEvent: null,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            goal: {
              id: "goal_1",
              legacyId: null,
              ownerUserId: "usr_a",
              name: "Weekly Cash",
              metric: "cash_collected",
              metricLabel: "Cash Collected",
              scope: "owner",
              targetUnit: "inr",
              target: 10000.5,
              targetDecimal: "10000.50",
              targetCount: null,
              targetAmount: "10000.50",
              period: "weekly",
              customFromIst: null,
              customToIst: null,
              effectiveFromIst: "2026-11-10",
              status: "active",
              archivedAt: null,
              archiveReason: null,
              createdByUserId: "usr_a",
              updatedByUserId: "usr_a",
              version: 1,
              createdAt: "2026-11-10T10:00:00Z",
              updatedAt: "2026-11-10T10:00:00Z",
            },
            revision: {
              id: "grev_1",
              goalId: "goal_1",
              ownerUserId: "usr_a",
              actorUserId: "usr_a",
              revisionNumber: 1,
              eventType: "goal.created",
              effectiveFromIst: "2026-11-10",
              snapshot: {
                name: "Weekly Cash",
                metric: "cash_collected",
                scope: "owner",
                targetUnit: "inr",
                targetCount: null,
                targetAmount: "10000.50",
                period: "weekly",
                customFromIst: null,
                customToIst: null,
                effectiveFromIst: "2026-11-10",
                status: "active",
                version: 1,
              },
              changeSummary: "Created goal",
              occurredIstDate: "2026-11-10",
              createdAt: "2026-11-10T10:00:00Z",
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );

    await updateOwnerSettings(
      { businessName: "Alpha Studio", expectedVersion: 0 },
      { method: "PUT", idempotencyKey: "idem_set_1" },
    );
    await createGoal({
      name: "Weekly Cash",
      metric: "cash_collected",
      scope: "owner",
      period: "weekly",
      target: "10000.50",
      idempotencyKey: "idem_goal_1",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchSpy.mock.calls[0]!;
    expect(new Headers(firstInit?.headers).get("idempotency-key")).toBe("idem_set_1");
    expect(firstInit?.credentials).toBe("same-origin");

    const [, secondInit] = fetchSpy.mock.calls[1]!;
    expect(new Headers(secondInit?.headers).get("idempotency-key")).toBe("idem_goal_1");
  });
});
