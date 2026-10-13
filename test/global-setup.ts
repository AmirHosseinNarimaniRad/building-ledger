import { connect } from "../lib/db";
import { runMigrations } from "../lib/migrate";
import { TEST_DB, testUrls } from "./support";

/** Recreates the test database from the migrations before every run. */
export default async function setup() {
  const urls = testUrls();

  const admin = connect(urls.admin);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const owner = connect(urls.owner);
  await runMigrations(owner, { appPassword: urls.appPassword });
  await owner.end();
}
