import { randomInt } from "node:crypto";
import { connect, type Sql } from "../lib/db";

export const TEST_DB = "ledger_test";

export function loadEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // CI passes env vars directly.
  }
}

/** Owner and app_user URLs for the test database, derived from the dev settings. */
export function testUrls() {
  loadEnv();
  const ownerUrl = process.env.DATABASE_OWNER_URL;
  const appPassword = process.env.APP_DB_PASSWORD;
  if (!ownerUrl || !appPassword) throw new Error("DATABASE_OWNER_URL and APP_DB_PASSWORD must be set");

  const owner = new URL(ownerUrl);
  owner.pathname = `/${TEST_DB}`;
  const app = new URL(owner);
  app.username = "app_user";
  app.password = appPassword;
  return { admin: ownerUrl, owner: owner.toString(), app: app.toString(), appPassword };
}

let app: Sql | undefined;
let owner: Sql | undefined;

/** Connection as app_user: exactly the privileges the app has. */
export function appDb(): Sql {
  app ??= connect(testUrls().app);
  return app;
}

/** Connection as the owner role, only for setup that the app itself can't do. */
export function ownerDb(): Sql {
  owner ??= connect(testUrls().owner);
  return owner;
}

/** A fresh manager, building and units. Every test gets its own building, so no cleanup is needed. */
export async function makeBuilding(sql: Sql, unitCount = 3) {
  const phone = `+98912${String(randomInt(10_000_000)).padStart(7, "0")}`;
  const [user] = await sql<{ id: string }[]>`INSERT INTO users (phone) VALUES (${phone}) RETURNING id`;
  const [building] = await sql<{ id: string }[]>`
    INSERT INTO buildings (name, manager_id) VALUES ('ساختمان تست', ${user.id}) RETURNING id`;
  const unitIds: string[] = [];
  for (let i = 1; i <= unitCount; i++) {
    const [u] = await sql<{ id: string }[]>`
      INSERT INTO units (building_id, label, sort_key, area_m2, occupants)
      VALUES (${building.id}, ${String(i)}, ${i}, ${80 + i}, ${i}) RETURNING id`;
    unitIds.push(u.id);
  }
  return { userId: user.id, buildingId: building.id, unitIds };
}

/** Inserts an entry as if it was created minutesAgo, to test the 30-minute window. */
export async function insertBackdated(sql: Sql, row: Record<string, unknown>, minutesAgo: number) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000);
  const [entry] = await sql<{ id: string }[]>`
    INSERT INTO ledger_entries ${sql({ ...row, createdAt })} RETURNING id`;
  return entry.id;
}
