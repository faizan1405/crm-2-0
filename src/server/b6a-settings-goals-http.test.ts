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

describe("Checkpoint B6A — Settings & Goals HTTP Router Security & Method Gating", () => {
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

  describe("1. Method Not Allowed (405 + Allow header)", () => {
    const methodCases: Array<{
      path: string;
      disallowed: string[];
      expectedAllow: string;
    }> = [
      {
        path: "/api/v1/settings",
        disallowed: ["POST", "DELETE"],
        expectedAllow: "GET, PUT, PATCH",
      },
      {
        path: "/api/v1/settings/definitions",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
      },
      {
        path: "/api/v1/settings/audit",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
      },
      { path: "/api/v1/goals", disallowed: ["PUT", "PATCH", "DELETE"], expectedAllow: "GET, POST" },
      {
        path: "/api/v1/goals/progress",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
      },
      {
        path: "/api/v1/goals/goal_abc123",
        disallowed: ["POST", "PUT", "DELETE"],
        expectedAllow: "GET, PATCH",
      },
      {
        path: "/api/v1/goals/goal_abc123/status",
        disallowed: ["GET", "PUT", "DELETE"],
        expectedAllow: "POST, PATCH",
      },
      {
        path: "/api/v1/goals/goal_abc123/archive",
        disallowed: ["GET", "PUT", "PATCH", "DELETE"],
        expectedAllow: "POST",
      },
      {
        path: "/api/v1/goals/goal_abc123/revisions",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
      },
      {
        path: "/api/v1/goals/goal_abc123/progress",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
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
      { method: "GET", path: "/api/v1/settings" },
      { method: "PUT", path: "/api/v1/settings", body: { businessName: "Studio" } },
      { method: "PATCH", path: "/api/v1/settings", body: { businessName: "Studio" } },
      { method: "GET", path: "/api/v1/settings/definitions" },
      { method: "GET", path: "/api/v1/settings/audit" },
      { method: "GET", path: "/api/v1/goals" },
      {
        method: "POST",
        path: "/api/v1/goals",
        body: { name: "Calls", metric: "calls_logged", period: "daily" },
      },
      { method: "GET", path: "/api/v1/goals/progress" },
      { method: "GET", path: "/api/v1/goals/goal_1" },
      { method: "PATCH", path: "/api/v1/goals/goal_1", body: { expectedVersion: 1, name: "X" } },
      { method: "POST", path: "/api/v1/goals/goal_1/status", body: { status: "paused" } },
      { method: "POST", path: "/api/v1/goals/goal_1/archive", body: { reason: "Done" } },
      { method: "GET", path: "/api/v1/goals/goal_1/revisions" },
      { method: "GET", path: "/api/v1/goals/goal_1/progress" },
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

  describe("3. Cross-Origin CSRF & Unknown Sub-Routes", () => {
    it("blocks cross-origin mutations with 403 across Settings and Goals routes", async () => {
      process.env["DATABASE_URL"] = "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused";

      const mutations: Array<{ method: string; path: string }> = [
        { method: "PUT", path: "/api/v1/settings" },
        { method: "PATCH", path: "/api/v1/settings" },
        { method: "POST", path: "/api/v1/goals" },
        { method: "PATCH", path: "/api/v1/goals/goal_1" },
        { method: "POST", path: "/api/v1/goals/goal_1/status" },
        { method: "POST", path: "/api/v1/goals/goal_1/archive" },
      ];

      for (const m of mutations) {
        const res = await handleCrmApiRequest(
          new Request(`http://127.0.0.1:3000${m.path}`, {
            method: m.method,
            headers: {
              "content-type": "application/json",
              origin: "https://attacker.example.com",
            },
            body: JSON.stringify({}),
          }),
          m.path,
          configuredEnv,
        );
        expect(res).not.toBeNull();
        expect(res!.status).toBe(403);
      }
    });

    it("returns null on unrecognized sub-paths so non-existent endpoints return 404 from API router", async () => {
      const unknownPaths = [
        "/api/v1/settings/nonexistent",
        "/api/v1/settings/definitions/extra",
        "/api/v1/goals/goal_1/unknown",
        "/api/v1/goals/goal_1/progress/extra",
      ];
      for (const path of unknownPaths) {
        const res = await handleCrmApiRequest(
          new Request(`http://127.0.0.1:3000${path}`),
          path,
          configuredEnv,
        );
        expect(res).toBeNull();
      }
    });
  });
});
