import { defineConfig } from "drizzle-kit";

function resolveDrizzleUrl(): string {
  const explicitUrl = process.env["DATABASE_URL"]?.trim();
  if (explicitUrl) return explicitUrl;

  const host = process.env["DB_HOST"]?.trim() || "127.0.0.1";
  const port = process.env["DB_PORT"]?.trim() || "3306";
  const user = encodeURIComponent(process.env["DB_USER"]?.trim() || "crm_dev");
  const password = encodeURIComponent(process.env["DB_PASSWORD"] ?? "");
  const database = process.env["DB_NAME"]?.trim() || "scale_flow_crm_v2_dev";

  const auth = password ? `${user}:${password}` : user;
  return `mysql://${auth}@${host}:${port}/${database}`;
}

export default defineConfig({
  dialect: "mysql",
  schema: "./src/server/db/schema.server.ts",
  out: "./src/server/db/migrations",
  strict: true,
  verbose: true,
  dbCredentials: {
    url: resolveDrizzleUrl(),
  },
});
