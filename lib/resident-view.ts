// What a resident sees on /r/[token]. Shown on purpose: the building's expenses and income,
// the fund balance and the documentation ratio — the transparency the product sells.
// Never shown: another unit's debt, name, phone, occupants or area, the arrears list, or
// anything from the manager's space. Only this module decides what leaves for residents.
import type { Db } from "./db";
import type { FormulaSnapshot } from "./charge";
import type { Formula } from "./charge";
import { buildingBalance, unitDebt, type LedgerRow } from "./ledger";
import { loadLedgerPage } from "./ledger-page";
import { jalaliMonthRange, toJalali, todayTehran } from "./date";
import type { DocumentRef } from "./documents";

export interface ResidentBill {
  jy: number;
  jm: number;
  totalRial: bigint;
  formula: Formula;
  shareRial: bigint;
  /** This unit's own inputs. */
  occupants: number;
  areaM2: string | null;
  /** Building-wide totals only; no per-unit data of neighbours. */
  unitCount: number;
  totalOccupants: number;
  totalAreaM2: number;
}

export interface ResidentView {
  buildingName: string;
  unitLabel: string;
  debtRial: bigint;
  balanceRial: bigint;
  bill: ResidentBill | null;
  month: { jy: number; jm: number };
  buildingRows: LedgerRow[];
  ownRows: LedgerRow[];
  documented: number;
  expenses: number;
  docs: Map<string, DocumentRef[]>;
  people: Map<string, string>;
  /** Every entry on the page; they are locked before the response is sent. */
  shownEntryIds: string[];
}

export async function loadResidentView(
  sql: Db,
  args: { unitId: string; buildingId: string; month?: { jy: number; jm: number } },
): Promise<ResidentView> {
  const [info] = await sql<{ buildingName: string; unitLabel: string }[]>`
    SELECT b.name AS building_name, u.label AS unit_label
    FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = ${args.unitId}`;

  const [period] = await sql<{ jalaliYear: number; jalaliMonth: number; totalRial: bigint; formula: FormulaSnapshot }[]>`
    SELECT cp.jalali_year, cp.jalali_month, cp.total_rial, cp.formula FROM charge_periods cp
    WHERE cp.building_id = ${args.buildingId} AND cp.voided_at IS NULL
      AND EXISTS (SELECT 1 FROM ledger_entries e WHERE e.period_id = cp.id AND e.unit_id = ${args.unitId})
    ORDER BY cp.jalali_year DESC, cp.jalali_month DESC LIMIT 1`;

  let bill: ResidentBill | null = null;
  if (period) {
    const units = period.formula.units;
    const own = units.find((u) => u.unitId === args.unitId)!;
    bill = {
      jy: period.jalaliYear,
      jm: period.jalaliMonth,
      totalRial: period.totalRial,
      formula: period.formula.formula,
      shareRial: BigInt(own.shareRial),
      occupants: own.occupants,
      areaM2: own.areaM2,
      unitCount: units.length,
      totalOccupants: units.reduce((a, u) => a + u.occupants, 0),
      // Summed in hundredths: floats would turn 297.33 into 297.33000000000004.
      totalAreaM2: units.reduce((a, u) => a + Math.round(Number(u.areaM2 ?? 0) * 100), 0) / 100,
    };
  }

  const month = args.month ?? (() => {
    const { jy, jm } = toJalali(todayTehran());
    return { jy, jm };
  })();
  const { start, end } = jalaliMonthRange(month.jy, month.jm);

  const page = await loadLedgerPage(sql, args.buildingId);
  const buildingRows = page.rows.filter(
    (r) =>
      (r.entry.kind === "expense" || r.entry.kind === "income") &&
      r.entry.occurredOn >= start &&
      r.entry.occurredOn < end,
  );
  const ownRows = page.rows.filter((r) => r.entry.unitId === args.unitId).slice(0, 12);
  const liveExpenses = buildingRows.filter((r) => r.entry.kind === "expense" && !r.voided);

  // Documents only for what is on the page.
  const shownEntryIds = [...buildingRows, ...ownRows].flatMap((r) => r.entryIds);
  const shown = new Set(shownEntryIds);
  const docs = new Map([...page.docs].filter(([entryId]) => shown.has(entryId)));

  return {
    buildingName: info.buildingName,
    unitLabel: info.unitLabel,
    debtRial: await unitDebt(sql, args.unitId),
    balanceRial: await buildingBalance(sql, args.buildingId),
    bill,
    month,
    buildingRows,
    ownRows,
    documented: liveExpenses.filter((r) => r.docState === "documented").length,
    expenses: liveExpenses.length,
    docs,
    people: page.people,
    shownEntryIds,
  };
}
