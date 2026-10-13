import { connect } from "../lib/db";
import { runMigrations } from "../lib/migrate";

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const sql = connect(url);
  await runMigrations(sql, { appPassword: process.env.APP_DB_PASSWORD, log: true });
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
