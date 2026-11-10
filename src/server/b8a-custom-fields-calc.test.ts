import fs from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  convertFieldValue,
  FIELD_TYPES,
  FILTER_OPS,
  generateFieldId,
  generateOptionId,
  generateTagId,
  isChoiceType,
  parseCustomFieldValue,
  RESERVED_FIELD_IDS,
  SENSITIVE_NAME_REGEX,
  slugify,
  TAG_COLORS,
  TAG_SCOPES,
  validateCustomFieldDef,
  VIEW_SORTS,
  VIEW_VISIBILITIES,
} from "./crm/customFieldsValidation.server";
import {
  appSchema,
  crmCoreSchema,
  crmCustomFields,
  crmLeadFieldValues,
  crmLeadTags,
  crmSavedViews,
  crmTagDefs,
} from "./db/schema.server";

describe("Checkpoint B8A — Custom Fields, Tags & Saved Views Schema & Calculation Unit Suite", () => {
  describe("1. Drizzle Schema & Migration 0010 Forward Safety", () => {
    it("exports crmSavedViews inside appSchema and crmCoreSchema alongside existing custom field tables", () => {
      expect(getTableName(crmCustomFields)).toBe("crm_custom_fields");
      expect(getTableName(crmLeadFieldValues)).toBe("crm_lead_field_values");
      expect(getTableName(crmTagDefs)).toBe("crm_tag_defs");
      expect(getTableName(crmLeadTags)).toBe("crm_lead_tags");
      expect(getTableName(crmSavedViews)).toBe("crm_saved_views");

      expect(crmCoreSchema.crmCustomFields).toBe(crmCustomFields);
      expect(crmCoreSchema.crmLeadFieldValues).toBe(crmLeadFieldValues);
      expect(crmCoreSchema.crmTagDefs).toBe(crmTagDefs);
      expect(crmCoreSchema.crmLeadTags).toBe(crmLeadTags);
      expect(crmCoreSchema.crmSavedViews).toBe(crmSavedViews);
      expect(appSchema.crmSavedViews).toBe(crmSavedViews);

      const savedViewCols = Object.keys(getTableColumns(crmSavedViews));
      expect(savedViewCols).toEqual(
        expect.arrayContaining([
          "id",
          "legacyId",
          "ownerUserId",
          "name",
          "visibility",
          "filterJson",
          "sort",
          "columnsJson",
          "archived",
          "isDefault",
          "isPinned",
          "schemaVersion",
          "version",
          "createdAt",
          "updatedAt",
        ]),
      );
    });

    it("verifies migration file 0010_b8a_saved_views.sql exists and is registered in _journal.json", () => {
      const migrationFile = path.resolve(process.cwd(), "src/server/db/migrations/0010_b8a_saved_views.sql");
      expect(fs.existsSync(migrationFile)).toBe(true);

      const sqlContent = fs.readFileSync(migrationFile, "utf8");
      expect(sqlContent).toContain("CREATE TABLE `crm_saved_views`");
      expect(sqlContent).toContain("`filter_json` text NOT NULL");
      expect(sqlContent).toContain("`owner_user_id` varchar(64) NOT NULL");

      const journalFile = path.resolve(process.cwd(), "src/server/db/migrations/meta/_journal.json");
      expect(fs.existsSync(journalFile)).toBe(true);

      const journal = JSON.parse(fs.readFileSync(journalFile, "utf8")) as {
        entries: Array<{ tag: string }>;
      };
      const hasEntry = journal.entries.some((e) => e.tag === "0010_b8a_saved_views");
      expect(hasEntry).toBe(true);
    });
  });

  describe("2. Custom Field Type Validation (All 11 Field Types)", () => {
    it("validates short 'text' (max 200 chars, empty -> undefined)", () => {
      const def = { fieldType: "text" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, "  hello world  ")).toEqual({ ok: true, value: "hello world" });
      expect(parseCustomFieldValue(def, "")).toEqual({ ok: true, value: undefined });
      expect(parseCustomFieldValue(def, null)).toEqual({ ok: true, value: undefined });
      expect(parseCustomFieldValue(def, undefined)).toEqual({ ok: true, value: undefined });
      expect(parseCustomFieldValue(def, "a".repeat(200))).toEqual({ ok: true, value: "a".repeat(200) });
      expect(parseCustomFieldValue(def, "a".repeat(201))).toEqual({
        ok: false,
        error: "Keep it under 200 characters.",
      });
      expect(parseCustomFieldValue(def, 123)).toEqual({ ok: false, error: "Enter text." });
    });

    it("validates 'longtext' (max 5000 chars)", () => {
      const def = { fieldType: "longtext" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, "Detailed paragraph")).toEqual({ ok: true, value: "Detailed paragraph" });
      expect(parseCustomFieldValue(def, "x".repeat(5000))).toEqual({ ok: true, value: "x".repeat(5000) });
      expect(parseCustomFieldValue(def, "x".repeat(5001))).toEqual({
        ok: false,
        error: "Keep it under 5,000 characters.",
      });
    });

    it("validates 'number' (finite numeric values, commas stripped)", () => {
      const def = { fieldType: "number" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, 42)).toEqual({ ok: true, value: 42 });
      expect(parseCustomFieldValue(def, -17.5)).toEqual({ ok: true, value: -17.5 });
      expect(parseCustomFieldValue(def, "1,000,500")).toEqual({ ok: true, value: 1000500 });
      expect(parseCustomFieldValue(def, "invalid_num")).toEqual({ ok: false, error: "Enter a number." });
      expect(parseCustomFieldValue(def, Number.NaN)).toEqual({ ok: false, error: "Enter a number." });
    });

    it("validates 'currency' (non-negative INR / Money structure)", () => {
      const def = { fieldType: "currency" as const, options: [], currency: "INR" };
      expect(parseCustomFieldValue(def, 5000)).toEqual({
        ok: true,
        value: { amount: 5000, currency: "INR" },
      });
      expect(parseCustomFieldValue(def, "₹ 25,000.50")).toEqual({
        ok: true,
        value: { amount: 25000.5, currency: "INR" },
      });
      expect(parseCustomFieldValue(def, { amount: 1500, currency: "USD" })).toEqual({
        ok: true,
        value: { amount: 1500, currency: "USD" },
      });
      expect(parseCustomFieldValue(def, -100)).toEqual({
        ok: false,
        error: "Enter an amount of zero or more.",
      });
      expect(parseCustomFieldValue(def, "abc")).toEqual({
        ok: false,
        error: "Enter an amount of zero or more.",
      });
    });

    it("validates 'date' (valid calendar day YYYY-MM-DD)", () => {
      const def = { fieldType: "date" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, "2026-11-10")).toEqual({ ok: true, value: "2026-11-10" });
      expect(parseCustomFieldValue(def, "2024-02-29")).toEqual({ ok: true, value: "2024-02-29" });
      expect(parseCustomFieldValue(def, "2026-02-29")).toEqual({ ok: false, error: "Pick a valid date." });
      expect(parseCustomFieldValue(def, "10-11-2026")).toEqual({ ok: false, error: "Pick a valid date." });
      expect(parseCustomFieldValue(def, "invalid")).toEqual({ ok: false, error: "Pick a valid date." });
    });

    it("validates 'checkbox' (strict boolean or empty)", () => {
      const def = { fieldType: "checkbox" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, true)).toEqual({ ok: true, value: true });
      expect(parseCustomFieldValue(def, false)).toEqual({ ok: true, value: false });
      expect(parseCustomFieldValue(def, undefined)).toEqual({ ok: true, value: undefined });
      expect(parseCustomFieldValue(def, "")).toEqual({ ok: true, value: undefined });
      expect(parseCustomFieldValue(def, "yes")).toEqual({ ok: false, error: "Choose yes or no." });
    });

    it("validates 'select' (only listed, non-archived option IDs)", () => {
      const options = [
        { id: "opt_alpha", label: "Alpha" },
        { id: "opt_beta", label: "Beta" },
        { id: "opt_arch", label: "Archived Option", archived: true },
      ];
      const def = { fieldType: "select" as const, options, currency: null };
      expect(parseCustomFieldValue(def, "opt_alpha")).toEqual({ ok: true, value: "opt_alpha" });
      expect(parseCustomFieldValue(def, "opt_beta")).toEqual({ ok: true, value: "opt_beta" });
      expect(parseCustomFieldValue(def, "opt_arch")).toEqual({
        ok: false,
        error: "Pick one of the listed options.",
      });
      expect(parseCustomFieldValue(def, "opt_unknown")).toEqual({
        ok: false,
        error: "Pick one of the listed options.",
      });
    });

    it("validates 'multiselect' (array of unique listed option IDs)", () => {
      const options = [
        { id: "opt_a", label: "A" },
        { id: "opt_b", label: "B" },
        { id: "opt_c", label: "C" },
      ];
      const def = { fieldType: "multiselect" as const, options, currency: null };
      expect(parseCustomFieldValue(def, ["opt_a", "opt_b"])).toEqual({
        ok: true,
        value: ["opt_a", "opt_b"],
      });
      // Deduplicates
      expect(parseCustomFieldValue(def, ["opt_a", "opt_a", "opt_b"])).toEqual({
        ok: true,
        value: ["opt_a", "opt_b"],
      });
      expect(parseCustomFieldValue(def, ["opt_a", "opt_missing"])).toEqual({
        ok: false,
        error: "One of the chosen options no longer exists.",
      });
      expect(parseCustomFieldValue(def, "not_an_array")).toEqual({
        ok: false,
        error: "Pick from the listed options.",
      });
    });

    it("validates 'url' (http / https protocol, no whitespace)", () => {
      const def = { fieldType: "url" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, "https://example.com/test")).toEqual({
        ok: true,
        value: "https://example.com/test",
      });
      // Auto-prefixes https://
      expect(parseCustomFieldValue(def, "example.com")).toEqual({
        ok: true,
        value: "https://example.com/",
      });
      expect(parseCustomFieldValue(def, "https://invalid url with spaces")).toEqual({
        ok: false,
        error: "Enter a web address.",
      });
      expect(parseCustomFieldValue(def, "ftp://example.com")).toEqual({
        ok: false,
        error: "Enter a valid web address.",
      });
    });

    it("validates 'email' (standard valid email, normalized to lowercase)", () => {
      const def = { fieldType: "email" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, "Faizan@Example.COM")).toEqual({
        ok: true,
        value: "faizan@example.com",
      });
      expect(parseCustomFieldValue(def, "invalid_email")).toEqual({
        ok: false,
        error: "Enter a valid email address.",
      });
    });

    it("validates 'phone' (7-15 digits, whitespace & symbols stripped)", () => {
      const def = { fieldType: "phone" as const, options: [], currency: null };
      expect(parseCustomFieldValue(def, "+91 (98765) 43210")).toEqual({
        ok: true,
        value: "+919876543210",
      });
      expect(parseCustomFieldValue(def, "9876543210")).toEqual({
        ok: true,
        value: "9876543210",
      });
      expect(parseCustomFieldValue(def, "123")).toEqual({
        ok: false,
        error: "Enter 7–15 digits, optionally starting with +.",
      });
    });
  });

  describe("3. Custom Field Definition Rules, Reserved IDs & Sensitive Credentials", () => {
    it("blocks reserved built-in lead keys as custom field IDs or labels", () => {
      for (const reserved of ["name", "phone", "email", "status", "stage", "notes", "pinned"]) {
        const err = validateCustomFieldDef({
          id: `cf_${reserved}`,
          label: reserved,
          type: "text",
        });
        expect(err).toBe("That name belongs to a built-in field.");
      }
    });

    it("blocks sensitive credential names from custom fields", () => {
      const forbiddenLabels = [
        "Database Password",
        "API Key Secret",
        "auth_token",
        "Client Credential",
      ];
      for (const label of forbiddenLabels) {
        const err = validateCustomFieldDef({
          label,
          type: "text",
        });
        expect(err).toBe(
          "Don't keep passwords, API keys or credentials in custom fields — note where they are stored instead.",
        );
      }
    });

    it("enforces choice types to have at least one active option and unique option names", () => {
      const emptyChoiceErr = validateCustomFieldDef({
        label: "Industry",
        type: "select",
        options: [],
      });
      expect(emptyChoiceErr).toBe("Add at least one option.");

      const duplicateChoiceErr = validateCustomFieldDef({
        label: "Industry",
        type: "select",
        options: [
          { id: "opt_1", label: "Tech" },
          { id: "opt_2", label: "tech" },
        ],
      });
      expect(duplicateChoiceErr).toBe("Two options have the same name.");
    });

    it("blocks employees from editing an owner-only field", () => {
      const err = validateCustomFieldDef({
        label: "Margin Target",
        type: "number",
        visibility: "owner",
        editable: "team",
      });
      expect(err).toBe("Employees can't edit a field they can't see.");
    });
  });

  describe("4. Field Value Conversion Across Types", () => {
    it("converts select to multiselect and select to text", () => {
      const fromDef = {
        fieldType: "select" as const,
        options: [
          { id: "opt_1", label: "Retail" },
          { id: "opt_2", label: "Healthcare" },
        ],
        currency: null,
      };
      const toMulti = {
        fieldType: "multiselect" as const,
        options: [
          { id: "opt_1", label: "Retail" },
          { id: "opt_2", label: "Healthcare" },
        ],
        currency: null,
      };
      const toText = {
        fieldType: "text" as const,
        options: [],
        currency: null,
      };

      expect(convertFieldValue("opt_1", fromDef, toMulti)).toEqual(["opt_1"]);
      expect(convertFieldValue("opt_1", fromDef, toText)).toBe("Retail");
    });

    it("converts currency to number and text", () => {
      const fromDef = {
        fieldType: "currency" as const,
        options: [],
        currency: "INR",
      };
      const toNum = {
        fieldType: "number" as const,
        options: [],
        currency: null,
      };
      const toText = {
        fieldType: "text" as const,
        options: [],
        currency: null,
      };

      expect(convertFieldValue({ amount: 50000, currency: "INR" }, fromDef, toNum)).toBe(50000);
      expect(convertFieldValue({ amount: 50000, currency: "INR" }, fromDef, toText)).toBe("50000");
    });

    it("returns undefined for incompatible type conversions", () => {
      const fromMulti = {
        fieldType: "multiselect" as const,
        options: [{ id: "opt_1", label: "A" }],
        currency: null,
      };
      const toCheck = {
        fieldType: "checkbox" as const,
        options: [],
        currency: null,
      };
      expect(convertFieldValue(["opt_1"], fromMulti, toCheck)).toBeUndefined();
    });
  });

  describe("5. Tags & ID Slugging Logic", () => {
    it("slugifies names into consistent safe IDs without collisions", () => {
      expect(slugify("High Value Deal")).toBe("high_value_deal");
      expect(slugify("VIP & Premium Client!")).toBe("vip_premium_client");

      const takenFieldIds = ["cf_budget", "cf_budget_2"];
      expect(generateFieldId("Budget", takenFieldIds)).toBe("cf_budget_3");

      const takenTagIds = ["tag_vip", "tag_vip_2"];
      expect(generateTagId("VIP", takenTagIds)).toBe("tag_vip_3");

      const takenOptIds = ["opt_tier_1"];
      expect(generateOptionId("Tier 1", takenOptIds)).toBe("opt_tier_1_2");
    });

    it("verifies all tag colors and scopes are recognized", () => {
      expect(TAG_COLORS).toEqual(["graphite", "green", "amber", "rose", "sky", "violet"]);
      expect(TAG_SCOPES).toEqual(["lead", "project", "both"]);
    });
  });

  describe("6. Saved Views & Filter Contracts", () => {
    it("validates all 20 filter operators, sort modes, and visibilities", () => {
      expect(FILTER_OPS).toHaveLength(20);
      expect(FILTER_OPS).toContain("is");
      expect(FILTER_OPS).toContain("is_not");
      expect(FILTER_OPS).toContain("any_of");
      expect(FILTER_OPS).toContain("contains");
      expect(FILTER_OPS).toContain("equals");
      expect(FILTER_OPS).toContain("gt");
      expect(FILTER_OPS).toContain("lt");
      expect(FILTER_OPS).toContain("between");
      expect(FILTER_OPS).toContain("before");
      expect(FILTER_OPS).toContain("after");
      expect(FILTER_OPS).toContain("on");
      expect(FILTER_OPS).toContain("within_days");
      expect(FILTER_OPS).toContain("today");
      expect(FILTER_OPS).toContain("overdue");
      expect(FILTER_OPS).toContain("yes");
      expect(FILTER_OPS).toContain("no");
      expect(FILTER_OPS).toContain("contains_any");
      expect(FILTER_OPS).toContain("contains_all");
      expect(FILTER_OPS).toContain("empty");

      expect(VIEW_SORTS).toEqual(["recent", "score", "value", "name", "updated"]);
      expect(VIEW_VISIBILITIES).toEqual(["personal", "shared", "company"]);
    });

    it("enforces max 20 conditions per saved view filter in viewFilterSchema", async () => {
      const { viewFilterSchema } = await import("./crm/customFieldsValidation.server");

      const validFilter = {
        mode: "and" as const,
        conditions: Array.from({ length: 20 }, (_, i) => ({
          id: `cond_${i}`,
          field: "stage",
          op: "is" as const,
          value: "new",
        })),
      };
      expect(viewFilterSchema.safeParse(validFilter).success).toBe(true);

      const invalidFilter = {
        mode: "and" as const,
        conditions: Array.from({ length: 21 }, (_, i) => ({
          id: `cond_${i}`,
          field: "stage",
          op: "is" as const,
          value: "new",
        })),
      };
      const res = viewFilterSchema.safeParse(invalidFilter);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe("Use at most 20 conditions.");
      }
    });

    it("rejects invalid condition operators in viewFilterSchema", async () => {
      const { viewFilterSchema } = await import("./crm/customFieldsValidation.server");

      const badOpFilter = {
        mode: "and" as const,
        conditions: [
          {
            id: "c1",
            field: "stage",
            op: "INVALID_OPERATOR" as any,
          },
        ],
      };
      expect(viewFilterSchema.safeParse(badOpFilter).success).toBe(false);
    });
  });

  describe("7. Zod Schema Payloads & Strict Input Sanitization", () => {
    it("validates createCustomFieldBodySchema constraints", async () => {
      const { createCustomFieldBodySchema } = await import("./crm/customFieldsValidation.server");

      expect(
        createCustomFieldBodySchema.safeParse({
          label: "Deal Budget",
          type: "currency",
        }).success,
      ).toBe(true);

      expect(
        createCustomFieldBodySchema.safeParse({
          label: "",
          type: "text",
        }).success,
      ).toBe(false);

      expect(
        createCustomFieldBodySchema.safeParse({
          label: "Valid",
          type: "invalid_type" as any,
        }).success,
      ).toBe(false);
    });

    it("validates createTagBodySchema constraints", async () => {
      const { createTagBodySchema } = await import("./crm/customFieldsValidation.server");

      expect(
        createTagBodySchema.safeParse({
          name: "High Priority",
          color: "rose",
        }).success,
      ).toBe(true);

      expect(
        createTagBodySchema.safeParse({
          name: "",
          color: "graphite",
        }).success,
      ).toBe(false);

      expect(
        createTagBodySchema.safeParse({
          name: "a".repeat(33),
          color: "graphite",
        }).success,
      ).toBe(false);
    });

    it("validates bulkTagLeadsBodySchema limits", async () => {
      const { bulkTagLeadsBodySchema } = await import("./crm/customFieldsValidation.server");

      expect(
        bulkTagLeadsBodySchema.safeParse({
          leadIds: ["lead_1", "lead_2"],
          tagId: "tag_vip",
          mode: "add",
        }).success,
      ).toBe(true);

      expect(
        bulkTagLeadsBodySchema.safeParse({
          leadIds: [],
          tagId: "tag_vip",
          mode: "add",
        }).success,
      ).toBe(false);
    });
  });
});
