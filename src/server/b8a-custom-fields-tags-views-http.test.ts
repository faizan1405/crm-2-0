import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseServerEnv } from "./config/env.server";
import { closeDatabasePool } from "./db/index.server";
import { handleCrmApiRequest } from "./http/crmRoutes.server";

function buildJsonRequest(
  path: string,
  method: string,
  options?: { headers?: Record<string, string>; body?: string },
): Request {
  const init: RequestInit = { method };
  if (options?.headers) init.headers = options.headers;
  if (options?.body !== undefined) init.body = options.body;
  return new Request(`http://127.0.0.1:3000${path}`, init);
}

describe("Checkpoint B8A — Custom Fields, Tags & Saved Views HTTP Security & Routing Suite", () => {
  const unconfiguredEnv = parseServerEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3000",
  });

  const configuredEnv = parseServerEnv({
    NODE_ENV: "test",
    APP_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_URL: "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused",
  });

  let prevDbUrl: string | undefined;

  beforeEach(() => {
    prevDbUrl = process.env["DATABASE_URL"];
  });

  afterEach(async () => {
    await closeDatabasePool();
    if (prevDbUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = prevDbUrl;
  });

  describe("1. Method Not Allowed (405 + Allow Header + Cache-Control: no-store)", () => {
    const methodCases: Array<{
      path: string;
      disallowed: string[];
      expectedAllow: string;
    }> = [
      {
        path: "/api/v1/custom-fields",
        disallowed: ["PUT", "PATCH", "DELETE"],
        expectedAllow: "GET, POST",
      },
      {
        path: "/api/v1/custom-fields/cf_budget",
        disallowed: ["POST", "PUT"],
        expectedAllow: "GET, PATCH, DELETE",
      },
      {
        path: "/api/v1/tags",
        disallowed: ["PUT", "PATCH", "DELETE"],
        expectedAllow: "GET, POST",
      },
      {
        path: "/api/v1/tags/tag_vip",
        disallowed: ["POST", "PUT"],
        expectedAllow: "GET, PATCH, DELETE",
      },
      {
        path: "/api/v1/saved-views",
        disallowed: ["PUT", "PATCH", "DELETE"],
        expectedAllow: "GET, POST",
      },
      {
        path: "/api/v1/saved-views/view_hot_leads",
        disallowed: ["POST", "PUT"],
        expectedAllow: "GET, PATCH, DELETE",
      },
      {
        path: "/api/v1/saved-views/view_hot_leads/duplicate",
        disallowed: ["GET", "PUT", "PATCH", "DELETE"],
        expectedAllow: "POST",
      },
      {
        path: "/api/v1/leads/lead_abc123/custom-fields",
        disallowed: ["POST", "PATCH", "DELETE"],
        expectedAllow: "GET, PUT",
      },
      {
        path: "/api/v1/leads/lead_abc123/tags",
        disallowed: ["PUT", "PATCH", "DELETE"],
        expectedAllow: "GET, POST",
      },
      {
        path: "/api/v1/leads/lead_abc123/tags/tag_vip",
        disallowed: ["GET", "POST", "PUT", "PATCH"],
        expectedAllow: "DELETE",
      },
      {
        path: "/api/v1/leads/bulk-tag",
        disallowed: ["GET", "PUT", "PATCH", "DELETE"],
        expectedAllow: "POST",
      },
    ];

    it.each(methodCases)(
      "rejects disallowed methods on $path with 405 and Allow: $expectedAllow",
      async ({ path, disallowed, expectedAllow }) => {
        for (const method of disallowed) {
          const req = buildJsonRequest(path, method, {
            ...(method === "GET" || method === "DELETE"
              ? {}
              : {
                  headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
                  body: JSON.stringify({}),
                }),
          });
          const res = await handleCrmApiRequest(req, path, unconfiguredEnv);
          expect(res).not.toBeNull();
          expect(res!.status).toBe(405);
          expect(res!.headers.get("allow")).toBe(expectedAllow);
          expect(res!.headers.get("cache-control")).toBe("no-store");
        }
      },
    );
  });

  describe("2. Fail-Closed DB Unconfigured (503) & Unauthenticated Access (401)", () => {
    const authEndpoints: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
      { method: "GET", path: "/api/v1/custom-fields" },
      {
        method: "POST",
        path: "/api/v1/custom-fields",
        body: { label: "Project Phase", type: "text" },
      },
      { method: "GET", path: "/api/v1/custom-fields/cf_test" },
      {
        method: "PATCH",
        path: "/api/v1/custom-fields/cf_test",
        body: { label: "Updated Phase" },
      },
      { method: "DELETE", path: "/api/v1/custom-fields/cf_test" },
      { method: "GET", path: "/api/v1/tags" },
      {
        method: "POST",
        path: "/api/v1/tags",
        body: { name: "Urgent", color: "rose" },
      },
      { method: "GET", path: "/api/v1/tags/tag_urgent" },
      {
        method: "PATCH",
        path: "/api/v1/tags/tag_urgent",
        body: { color: "amber" },
      },
      { method: "DELETE", path: "/api/v1/tags/tag_urgent" },
      { method: "GET", path: "/api/v1/saved-views" },
      {
        method: "POST",
        path: "/api/v1/saved-views",
        body: { name: "High Priority", filter: { mode: "and", conditions: [] } },
      },
      { method: "GET", path: "/api/v1/saved-views/view_hp" },
      {
        method: "PATCH",
        path: "/api/v1/saved-views/view_hp",
        body: { name: "Urgent Leads" },
      },
      { method: "DELETE", path: "/api/v1/saved-views/view_hp" },
      { method: "POST", path: "/api/v1/saved-views/view_hp/duplicate" },
      { method: "GET", path: "/api/v1/leads/lead_1/custom-fields" },
      {
        method: "PUT",
        path: "/api/v1/leads/lead_1/custom-fields",
        body: { values: { cf_phase: "Discovery" } },
      },
      { method: "GET", path: "/api/v1/leads/lead_1/tags" },
      {
        method: "POST",
        path: "/api/v1/leads/lead_1/tags",
        body: { tagId: "tag_vip" },
      },
      { method: "DELETE", path: "/api/v1/leads/lead_1/tags/tag_vip" },
      {
        method: "POST",
        path: "/api/v1/leads/bulk-tag",
        body: { leadIds: ["lead_1"], tagId: "tag_vip", mode: "add" },
      },
    ];

    it.each(authEndpoints)(
      "fails closed with 503 when DB unconfigured and 401 when unauthenticated on $method $path",
      async ({ method, path, body }) => {
        delete process.env["DATABASE_URL"];
        await closeDatabasePool();

        const req503 = buildJsonRequest(path, method, {
          ...(method === "GET"
            ? {}
            : { headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" } }),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const res503 = await handleCrmApiRequest(req503, path, unconfiguredEnv);
        expect(res503).not.toBeNull();
        expect(res503!.status).toBe(503);
        expect(res503!.headers.get("cache-control")).toBe("no-store");

        process.env["DATABASE_URL"] = "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused";
        await closeDatabasePool();

        const req401 = buildJsonRequest(path, method, {
          ...(method === "GET"
            ? {}
            : { headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" } }),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const res401 = await handleCrmApiRequest(req401, path, configuredEnv);
        expect(res401).not.toBeNull();
        expect(res401!.status).toBe(401);
        const data401 = (await res401!.json()) as { ok: boolean; error: { code: string } };
        expect(data401.ok).toBe(false);
        expect(data401.error.code).toBe("unauthenticated");
      },
    );
  });

  describe("3. Cross-Origin CSRF Protection on Custom Fields, Tags & Views", () => {
    it("blocks mutations with 403 when origin is invalid or untrusted", async () => {
      process.env["DATABASE_URL"] = "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused";

      const mutations: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [
        {
          method: "POST",
          path: "/api/v1/custom-fields",
          body: { label: "Test", type: "text" },
        },
        {
          method: "PATCH",
          path: "/api/v1/custom-fields/cf_test",
          body: { label: "Updated" },
        },
        {
          method: "DELETE",
          path: "/api/v1/custom-fields/cf_test",
        },
        {
          method: "POST",
          path: "/api/v1/tags",
          body: { name: "VIP" },
        },
        {
          method: "PATCH",
          path: "/api/v1/tags/tag_vip",
          body: { color: "gold" },
        },
        {
          method: "DELETE",
          path: "/api/v1/tags/tag_vip",
        },
        {
          method: "POST",
          path: "/api/v1/saved-views",
          body: { name: "View 1", filter: { mode: "and", conditions: [] } },
        },
        {
          method: "PATCH",
          path: "/api/v1/saved-views/view_1",
          body: { name: "View 2" },
        },
        {
          method: "DELETE",
          path: "/api/v1/saved-views/view_1",
        },
        {
          method: "POST",
          path: "/api/v1/saved-views/view_1/duplicate",
        },
        {
          method: "PUT",
          path: "/api/v1/leads/lead_1/custom-fields",
          body: { values: {} },
        },
        {
          method: "POST",
          path: "/api/v1/leads/lead_1/tags",
          body: { tagId: "tag_vip" },
        },
        {
          method: "DELETE",
          path: "/api/v1/leads/lead_1/tags/tag_vip",
        },
        {
          method: "POST",
          path: "/api/v1/leads/bulk-tag",
          body: { leadIds: ["lead_1"], tagId: "tag_vip", mode: "add" },
        },
      ];

      for (const { method, path, body } of mutations) {
        const req = buildJsonRequest(path, method, {
          headers: {
            origin: "https://malicious-attacker.com",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });

        const res = await handleCrmApiRequest(req, path, configuredEnv);
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
        const data = (await res!.json()) as { ok: boolean; error: { code: string } };
        expect(data.ok).toBe(false);
        expect(data.error.code).toBe("csrf_rejected");
      }
    });
  });
});
