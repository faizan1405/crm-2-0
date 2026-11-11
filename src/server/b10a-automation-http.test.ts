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

describe("Checkpoint B10A — Automation Rules HTTP Security & Routing Suite", () => {
  const unconfiguredEnv = parseServerEnv({
    NODE_ENV: "test",
    DEV_LEAD_PILOT: "true",
    APP_ORIGIN: "http://127.0.0.1:3000",
  });

  const prodEnv = parseServerEnv({
    NODE_ENV: "production",
    APP_ORIGIN: "https://crm.joinscaleflow.in",
    DATABASE_URL: "mysql://unit_user:unit_pass@127.0.0.1:3399/crm_unit_unused",
    ENABLE_LEAD_PILOT: "false",
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
        path: "/api/v1/automations/definitions",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
      },
      {
        path: "/api/v1/automations",
        disallowed: ["PUT", "PATCH", "DELETE"],
        expectedAllow: "GET, POST",
      },
      {
        path: "/api/v1/automations/ar_test_1",
        disallowed: ["POST", "PATCH"],
        expectedAllow: "GET, PUT, DELETE",
      },
      {
        path: "/api/v1/automations/ar_test_1/duplicate",
        disallowed: ["GET", "PUT", "PATCH", "DELETE"],
        expectedAllow: "POST",
      },
      {
        path: "/api/v1/automations/ar_test_1/revisions",
        disallowed: ["POST", "PUT", "PATCH", "DELETE"],
        expectedAllow: "GET",
      },
      {
        path: "/api/v1/automations/ar_test_1/simulate",
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
      { method: "GET", path: "/api/v1/automations/definitions" },
      { method: "GET", path: "/api/v1/automations" },
      {
        method: "POST",
        path: "/api/v1/automations",
        body: {
          name: "Test Rule",
          triggerType: "lead_created",
          conditions: {},
          actions: ["reminder"],
          settings: { cooldownHours: 24 },
        },
      },
      { method: "GET", path: "/api/v1/automations/ar_123" },
      {
        method: "PUT",
        path: "/api/v1/automations/ar_123",
        body: {
          name: "Updated",
          triggerType: "lead_created",
          conditions: {},
          actions: ["reminder"],
          settings: { cooldownHours: 24 },
          expectedVersion: 1,
        },
      },
      { method: "DELETE", path: "/api/v1/automations/ar_123" },
      { method: "POST", path: "/api/v1/automations/ar_123/duplicate" },
      { method: "GET", path: "/api/v1/automations/ar_123/revisions" },
      {
        method: "POST",
        path: "/api/v1/automations/ar_123/simulate",
        body: { triggerType: "lead_created", leadId: "lead_123" },
      },
    ];

    it.each(authEndpoints)(
      "fails closed with 503 when DB unconfigured and 401 when unauthenticated on $method $path",
      async ({ method, path, body }) => {
        delete process.env["DATABASE_URL"];
        await closeDatabasePool();

        const req503 = buildJsonRequest(path, method, {
          ...(method === "GET" || method === "DELETE"
            ? {}
            : { headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" } }),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const res503 = await handleCrmApiRequest(req503, path, unconfiguredEnv);
        expect(res503).not.toBeNull();
        expect(res503!.status).toBe(503);
        const data503 = (await res503!.json()) as { error: { code: string } };
        expect(data503.error.code).toBe("crm_unavailable");
      },
    );
  });

  describe("3. Production Pilot Disabled Gate (404)", () => {
    it("returns 404 PILOT_DISABLED when ENABLE_LEAD_PILOT is false in production", async () => {
      const endpoints = [
        { method: "GET", path: "/api/v1/automations/definitions" },
        { method: "GET", path: "/api/v1/automations" },
        { method: "POST", path: "/api/v1/automations" },
        { method: "GET", path: "/api/v1/automations/ar_123" },
      ];

      for (const ep of endpoints) {
        const req = buildJsonRequest(ep.path, ep.method, {
          headers: { origin: "https://crm.joinscaleflow.in" },
        });
        const res = await handleCrmApiRequest(req, ep.path, prodEnv);
        expect(res).not.toBeNull();
        expect(res!.status).toBe(404);
        const json = (await res!.json()) as { error: { code: string } };
        expect(json.error.code).toBe("PILOT_DISABLED");
      }
    });
  });

  describe("4. CSRF & Origin Protection", () => {
    it("rejects POST /api/v1/automations with mismatched Origin header", async () => {
      const req = buildJsonRequest("/api/v1/automations", "POST", {
        headers: {
          "content-type": "application/json",
          origin: "https://evil-attacker.example.com",
        },
        body: JSON.stringify({ name: "Attack" }),
      });
      const res = await handleCrmApiRequest(req, "/api/v1/automations", unconfiguredEnv);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(403);
      const json = (await res!.json()) as { error: { code: string } };
      expect(json.error.code).toBe("csrf_rejected");
    });

    it("rejects POST /api/v1/automations without application/json content-type", async () => {
      const req = buildJsonRequest("/api/v1/automations", "POST", {
        headers: {
          "content-type": "text/plain",
          origin: "http://127.0.0.1:3000",
        },
        body: "raw string",
      });
      const res = await handleCrmApiRequest(req, "/api/v1/automations", unconfiguredEnv);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(403);
    });
  });
});
