// The monthly report: where the fund started, what came in, what went out, where it ended.
// Totals come from the same signed effects as every balance, so the report always reconciles:
// closing = opening + collected + other income − expenses.
import type { Db } from "./db";
import { jalaliMonthRange } from "./date";
import { loadLedger, type LedgerRow } from "./ledger";

export interface MonthlyReport {
  jy: number;
  jm: number;
  openingRial: bigint;
  closingRial: bigint;
  collectedRial: bigint; // payments from units
  otherIncomeRial: bigint;
  expensesRial: bigint; // positive number
  chargedRial: bigint; // charges issued for the month (owed, not cash)
  arrearsRial: bigint; // owed by all units today
  expenseRows: LedgerRow[];
  incomeRows: LedgerRow[];
  documented: number;
  expenseCount: number;
}

export async function monthlyReport(sql: Db, buildingId: string, jy: number, jm: number): Promise<MonthlyReport> {
  const { start, end } = jalaliMonthRange(jy, jm);

  const [t] = await sql<
    { openingRial: bigint; closingRial: bigint; collectedRial: bigint; otherIncomeRial: bigint; expensesRial: bigint; chargedRial: bigint }[]
  >`
    WITH x AS (
      SELECT f.cash_rial, f.debt_rial, e.occurred_on,
             COALESCE(t.kind, e.kind) AS base_kind  -- a reversal counts with what it reverses
      FROM ledger_effects f
      JOIN ledger_entries e ON e.id = f.id
      LEFT JOIN ledger_entries t ON t.id = e.target_id AND e.kind = 'reversal'
      WHERE f.building_id = ${buildingId}
    )
    SELECT
      COALESCE(SUM(cash_rial) FILTER (WHERE occurred_on < ${start}), 0)::bigint AS opening_rial,
      COALESCE(SUM(cash_rial) FILTER (WHERE occurred_on < ${end}), 0)::bigint AS closing_rial,
      COALESCE(SUM(cash_rial) FILTER (WHERE occurred_on >= ${start} AND occurred_on < ${end} AND base_kind = 'payment'), 0)::bigint AS collected_rial,
      COALESCE(SUM(cash_rial) FILTER (WHERE occurred_on >= ${start} AND occurred_on < ${end} AND base_kind = 'income'), 0)::bigint AS other_income_rial,
      COALESCE(-SUM(cash_rial) FILTER (WHERE occurred_on >= ${start} AND occurred_on < ${end} AND base_kind = 'expense'), 0)::bigint AS expenses_rial,
      COALESCE(SUM(debt_rial) FILTER (WHERE occurred_on >= ${start} AND occurred_on < ${end} AND base_kind = 'charge_issued'), 0)::bigint AS charged_rial
    FROM x`;

  const [{ arrearsRial }] = await sql<{ arrearsRial: bigint }[]>`
    SELECT COALESCE(SUM(debt_rial), 0)::bigint AS arrears_rial FROM unit_debts
    WHERE building_id = ${buildingId} AND debt_rial > 0`;

  const inMonth = (r: LedgerRow) => r.entry.occurredOn >= start && r.entry.occurredOn < end;
  const rows = (await loadLedger(sql, buildingId)).filter(inMonth);
  const expenseRows = rows.filter((r) => r.entry.kind === "expense");
  const live = expenseRows.filter((r) => !r.voided);

  return {
    jy,
    jm,
    ...t,
    arrearsRial,
    expenseRows,
    incomeRows: rows.filter((r) => r.entry.kind === "income"),
    documented: live.filter((r) => r.docState === "documented").length,
    expenseCount: live.length,
  };
}
