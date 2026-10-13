import type { Db } from "./db";
import { jalaliMonthRange, toJalali, todayTehran } from "./date";
import { loadLedger } from "./ledger";

export interface Building {
  id: string;
  name: string;
  address: string | null;
  managerId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string) {
  return UUID.test(s);
}

export async function listBuildings(sql: Db, userId: string) {
  return sql<Building[]>`
    SELECT id, name, address, manager_id FROM buildings WHERE manager_id = ${userId} ORDER BY created_at`;
}

export async function buildingForManager(sql: Db, buildingId: string, userId: string) {
  if (!isUuid(buildingId)) return null;
  const [b] = await sql<Building[]>`
    SELECT id, name, address, manager_id FROM buildings
    WHERE id = ${buildingId} AND manager_id = ${userId}`;
  return b ?? null;
}

export async function createBuilding(sql: Db, args: { userId: string; name: string; address: string | null }) {
  const [b] = await sql<{ id: string }[]>`
    INSERT INTO buildings (name, address, manager_id) VALUES (${args.name}, ${args.address}, ${args.userId})
    RETURNING id`;
  return b.id;
}

export interface Dashboard {
  balanceRial: bigint;
  arrearsRial: bigint;
  unitsOwing: number;
  unitCount: number;
  /** This month's expenses: how many have a document, out of how many. */
  documented: number;
  expenses: number;
}

export async function dashboard(sql: Db, buildingId: string): Promise<Dashboard> {
  const [money] = await sql<{ balanceRial: bigint; arrearsRial: bigint; unitsOwing: number; unitCount: number }[]>`
    SELECT
      (SELECT balance_rial FROM building_balances WHERE building_id = ${buildingId}) AS balance_rial,
      (SELECT COALESCE(SUM(debt_rial), 0)::bigint FROM unit_debts WHERE building_id = ${buildingId} AND debt_rial > 0) AS arrears_rial,
      (SELECT count(*)::int FROM unit_debts WHERE building_id = ${buildingId} AND debt_rial > 0) AS units_owing,
      (SELECT count(*)::int FROM units WHERE building_id = ${buildingId} AND is_active) AS unit_count`;

  const { jy, jm } = toJalali(todayTehran());
  const { start, end } = jalaliMonthRange(jy, jm);
  const expenses = (await loadLedger(sql, buildingId)).filter(
    (r) => r.entry.kind === "expense" && !r.voided && r.entry.occurredOn >= start && r.entry.occurredOn < end,
  );
  return {
    ...money,
    balanceRial: money.balanceRial ?? 0n,
    documented: expenses.filter((r) => r.docState === "documented").length,
    expenses: expenses.length,
  };
}
