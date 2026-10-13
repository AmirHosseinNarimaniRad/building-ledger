import { withTx, type Db, type Tx } from "@/lib/db";
import { fromJalali, jalaliMonthName } from "@/lib/date";
import { lockMonth } from "@/lib/ledger";
import { ChargeError, computeShares, type ChargeUnit, type Formula } from "./split";

export interface ShareRow {
  unitId: string;
  label: string;
  shareRial: bigint;
}

/** What gets stored in charge_periods.formula: the formula and the unit data it used. */
export interface FormulaSnapshot {
  formula: Formula;
  units: { unitId: string; label: string; areaM2: string | null; occupants: number; shareRial: string }[];
}

const fa = new Intl.NumberFormat("fa-IR", { useGrouping: false });

async function activeUnits(sql: Db, buildingId: string): Promise<ChargeUnit[]> {
  return sql<ChargeUnit[]>`
    SELECT id, label, sort_key, area_m2, occupants FROM units
    WHERE building_id = ${buildingId} AND is_active
    ORDER BY sort_key`;
}

/** The per-unit preview shown before the manager confirms. Writes nothing. */
export async function previewCharge(
  sql: Db,
  args: { buildingId: string; totalRial: bigint; formula: Formula },
): Promise<ShareRow[]> {
  const units = await activeUnits(sql, args.buildingId);
  const shares = computeShares(units, args.totalRial, args.formula);
  return units.map((u, i) => ({ unitId: u.id, label: u.label, shareRial: shares[i] }));
}

function isActivePeriodClash(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint_name?: string }).constraint_name === "one_active_period_per_month"
  );
}

/**
 * Issues a month's charge in one transaction: the period with its formula snapshot,
 * one charge_issued per unit with a share, and the lock on every entry of that month.
 */
export async function issueCharge(
  sql: Db,
  args: { buildingId: string; jy: number; jm: number; totalRial: bigint; formula: Formula; by: string },
): Promise<{ periodId: string; shares: ShareRow[] }> {
  const run = async (tx: Tx) => {
    const shares = await previewCharge(tx, args);
    const units = await activeUnits(tx, args.buildingId);
    const snapshot: FormulaSnapshot = {
      formula: args.formula,
      units: units.map((u, i) => ({
        unitId: u.id,
        label: u.label,
        areaM2: u.areaM2,
        occupants: u.occupants,
        shareRial: shares[i].shareRial.toString(),
      })),
    };

    const [period] = await tx<{ id: string }[]>`
      INSERT INTO charge_periods (building_id, jalali_year, jalali_month, total_rial, formula)
      VALUES (${args.buildingId}, ${args.jy}, ${args.jm}, ${args.totalRial}, ${tx.json(snapshot as never)})
      RETURNING id`;

    const title = `شارژ ${jalaliMonthName(args.jm)} ${fa.format(args.jy)}`;
    const occurredOn = fromJalali(args.jy, args.jm, 1);
    for (const s of shares) {
      if (s.shareRial === 0n) continue; // e.g. an empty unit under by_occupants owes nothing
      await tx`
        INSERT INTO ledger_entries (building_id, kind, amount_rial, occurred_on, title, unit_id, period_id, created_by)
        VALUES (${args.buildingId}, 'charge_issued', ${s.shareRial}, ${occurredOn}, ${title},
                ${s.unitId}, ${period.id}, ${args.by})`;
    }

    await lockMonth(tx, args.buildingId, args.jy, args.jm);
    return { periodId: period.id, shares };
  };

  try {
    return await withTx(sql, run);
  } catch (err) {
    if (isActivePeriodClash(err)) {
      throw new ChargeError("already_issued", "شارژ این ماه قبلاً صادر شده است");
    }
    throw err;
  }
}

/**
 * A mistake in an issued charge is never edited: every charge row of the period gets a
 * reversal with the reason, the period is voided, and the month is issued again.
 */
export async function reissueCharge(
  sql: Db,
  args: { periodId: string; reason: string; totalRial: bigint; formula: Formula; by: string },
): Promise<{ periodId: string; shares: ShareRow[] }> {
  return withTx(sql, async (tx) => {
    const [period] = await tx<{ buildingId: string; jalaliYear: number; jalaliMonth: number }[]>`
      SELECT building_id, jalali_year, jalali_month FROM charge_periods
      WHERE id = ${args.periodId} AND voided_at IS NULL
      FOR UPDATE`;
    if (!period) throw new ChargeError("not_found", "این دوره شارژ پیدا نشد یا قبلاً باطل شده است");

    await tx`
      INSERT INTO ledger_entries
        (building_id, kind, amount_rial, occurred_on, title, unit_id, period_id, target_id, edit_reason, created_by)
      SELECT building_id, 'reversal', amount_rial, occurred_on, title, unit_id, period_id, id, ${args.reason}, ${args.by}
      FROM ledger_entries
      WHERE period_id = ${args.periodId} AND kind = 'charge_issued'`;
    await tx`UPDATE charge_periods SET voided_at = now() WHERE id = ${args.periodId}`;

    return issueCharge(tx, {
      buildingId: period.buildingId,
      jy: period.jalaliYear,
      jm: period.jalaliMonth,
      totalRial: args.totalRial,
      formula: args.formula,
      by: args.by,
    });
  });
}
