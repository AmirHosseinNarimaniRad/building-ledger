// Everything a ledger page needs, loaded once. Shared by the manager and resident pages.
import type { Db } from "./db";
import { loadLedger } from "./ledger";
import { documentsByEntry } from "./documents";

export async function loadLedgerPage(sql: Db, buildingId: string) {
  const [rows, docs, units, people] = await Promise.all([
    loadLedger(sql, buildingId),
    documentsByEntry(sql, buildingId),
    sql<{ id: string; label: string }[]>`SELECT id, label FROM units WHERE building_id = ${buildingId}`,
    sql<{ id: string; name: string }[]>`
      SELECT u.id, COALESCE(u.display_name, 'مدیر') AS name FROM users u
      JOIN buildings b ON b.manager_id = u.id WHERE b.id = ${buildingId}`,
  ]);
  return {
    rows,
    docs,
    unitLabels: new Map(units.map((u) => [u.id, u.label])),
    people: new Map(people.map((p) => [p.id, p.name])),
  };
}
