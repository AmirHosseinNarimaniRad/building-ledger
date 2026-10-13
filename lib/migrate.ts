import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Sql } from "./db";

const dir = path.join(process.cwd(), "db", "migrations");

/**
 * Applies db/migrations/*.sql in name order, each once and in its own transaction.
 * Must run as the owner role. If appPassword is given, sets app_user's login password.
 */
export async function runMigrations(sql: Sql, opts: { appPassword?: string; log?: boolean } = {}) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const done = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    if (opts.log) console.log(`applied ${file}`);
  }

  if (opts.appPassword) {
    // ALTER ROLE takes no bind parameters; quote the literal ourselves.
    const literal = `'${opts.appPassword.replaceAll("'", "''")}'`;
    await sql.unsafe(`ALTER ROLE app_user PASSWORD ${literal}`);
  }
}
