import "@tanstack/react-start/server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { CrmDatabase } from "./index.server";

export async function runDatabaseMigrations(
  db: CrmDatabase,
  migrationsFolder: string = path.resolve(process.cwd(), "src/server/db/migrations"),
): Promise<void> {
  await migrate(db, { migrationsFolder });
}
