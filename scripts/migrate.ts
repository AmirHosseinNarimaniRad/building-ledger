// Applies db/migrations/*.sql in name order, each in its own transaction, once.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "../lib/db";

const dir = path.join(process.cwd(), "db", "migrations");

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const sql = connect(url);

  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name));

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.log(`applied ${file}`);
  }
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
