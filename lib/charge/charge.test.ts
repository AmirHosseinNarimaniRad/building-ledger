import { afterAll, describe, expect, it } from "vitest";
import { appDb, makeBuilding, ownerDb } from "@/test/support";
import { fromJalali } from "@/lib/date";
import { buildingBalance, createEntry, loadLedger, unitDebt } from "@/lib/ledger";
import {
  ChargeError,
  computeShares,
  issueCharge,
  reissueCharge,
  splitCharge,
  type ChargeUnit,
  type Formula,
} from "@/lib/charge";

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const toman = (n: number) => BigInt(n) * 10n;

// Mixed areas and occupants, unsorted, one empty unit.
const UNITS: ChargeUnit[] = [
  { id: "c", label: "۲۰۱", sortKey: 21, areaM2: "118.40", occupants: 4 },
  { id: "a", label: "۱۰۱", sortKey: 11, areaM2: "92.50", occupants: 3 },
  { id: "e", label: "۳۰۲", sortKey: 32, areaM2: "62.50", occupants: 0 },
  { id: "b", label: "۱۰۲", sortKey: 12, areaM2: "88.00", occupants: 6 },
  { id: "d", label: "۳۰۱", sortKey: 31, areaM2: "76.00", occupants: 1 },
];

function byId(units: ChargeUnit[], shares: bigint[]) {
  return Object.fromEntries(units.map((u, i) => [u.id, shares[i]]));
}

describe("charge split (spec section 5)", () => {
  it("1000 toman between 3 equal units adds up to exactly 1000 toman, all whole tomans", () => {
    const shares = splitCharge(toman(1000), [1n, 1n, 1n], [1, 2, 3]);
    expect(sum(shares)).toBe(toman(1000));
    expect(shares).toEqual([toman(334), toman(333), toman(333)]);
    expect(shares.every((s) => s % 10n === 0n)).toBe(true);
  });

  it("the same input always gives the same output, whatever the input order", () => {
    const formula: Formula = { mode: "mixed", fixedShareBp: 4000 };
    const first = byId(UNITS, computeShares(UNITS, toman(12_345_677), formula));
    const again = byId(UNITS, computeShares(UNITS, toman(12_345_677), formula));
    const reversed = [...UNITS].reverse();
    const shuffled = byId(reversed, computeShares(reversed, toman(12_345_677), formula));
    expect(again).toEqual(first);
    expect(shuffled).toEqual(first);
  });

  it("mixed with fixedShareBp = 0 is exactly by_occupants", () => {
    expect(computeShares(UNITS, toman(9_999_999), { mode: "mixed", fixedShareBp: 0 })).toEqual(
      computeShares(UNITS, toman(9_999_999), { mode: "by_occupants" }),
    );
  });

  it("mixed with fixedShareBp = 10000 is exactly equal", () => {
    expect(computeShares(UNITS, toman(9_999_999), { mode: "mixed", fixedShareBp: 10_000 })).toEqual(
      computeShares(UNITS, toman(9_999_999), { mode: "equal" }),
    );
  });

  it("a missing area in by_area gives an understandable error, not zero", () => {
    const units = UNITS.map((u) => (u.id === "b" ? { ...u, areaM2: null } : u));
    expect(() => computeShares(units, toman(1000), { mode: "by_area" })).toThrow(
      expect.objectContaining({ code: "missing_area", message: expect.stringContaining("۱۰۲") }),
    );
  });

  it("a unit with weight zero gets nothing, not even a leftover toman", () => {
    // The empty unit has the lowest sort_key, so it would be first in line for leftovers.
    const units = [{ ...UNITS[2], sortKey: 1 }, ...UNITS.filter((u) => u.id !== "e")];
    for (let total = 1; total <= 50; total++) {
      const shares = byId(units, computeShares(units, toman(total), { mode: "by_occupants" }));
      expect(shares.e).toBe(0n);
    }
  });

  it("shares always add up to the total (random cases, every formula)", () => {
    const formulas: Formula[] = [
      { mode: "equal" },
      { mode: "by_area" },
      { mode: "by_occupants" },
      { mode: "mixed", fixedShareBp: 0 },
      { mode: "mixed", fixedShareBp: 3333 },
      { mode: "mixed", fixedShareBp: 10_000 },
    ];
    for (let i = 0; i < 500; i++) {
      const total = toman(1 + Math.floor(Math.random() * 500_000_000));
      for (const f of formulas) {
        const shares = computeShares(UNITS, total, f);
        expect(sum(shares)).toBe(total);
        expect(shares.every((s) => s >= 0n && s % 10n === 0n)).toBe(true);
      }
    }
  });

  it("area weights are exact, with no floating point", () => {
    const units: ChargeUnit[] = [
      { id: "x", label: "x", sortKey: 1, areaM2: "0.10", occupants: 1 },
      { id: "y", label: "y", sortKey: 2, areaM2: "0.20", occupants: 1 },
    ];
    expect(computeShares(units, toman(300), { mode: "by_area" })).toEqual([toman(100), toman(200)]);
  });
});

describe("issuing charges", () => {
  const sql = appDb();
  afterAll(async () => {
    await sql.end();
    await ownerDb().end();
  });

  it("issues one charge per unit, snapshots the formula, and locks the month", async () => {
    const b = await makeBuilding(sql, 3);
    const expense = await createEntry(sql, {
      buildingId: b.buildingId,
      kind: "expense",
      amountRial: toman(500_000),
      occurredOn: fromJalali(1405, 7, 10),
      title: "نظافت",
      docState: "pending_doc",
      createdBy: b.userId,
    });

    const { periodId, shares } = await issueCharge(sql, {
      buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(3_000_001), formula: { mode: "equal" }, by: b.userId,
    });
    expect(sum(shares.map((s) => s.shareRial))).toBe(toman(3_000_001));
    expect(await unitDebt(sql, b.unitIds[0])).toBe(toman(1_000_001));
    expect(await unitDebt(sql, b.unitIds[1])).toBe(toman(1_000_000));

    const [{ locked }] = await sql<{ locked: boolean }[]>`
      SELECT locked_at IS NOT NULL AS locked FROM ledger_entries WHERE id = ${expense.id}`;
    expect(locked).toBe(true);

    // Changing a unit later does not change what was issued.
    await sql`UPDATE units SET occupants = 9 WHERE id = ${b.unitIds[0]}`;
    const [period] = await sql<{ formula: { formula: Formula; units: { occupants: number }[] } }[]>`
      SELECT formula FROM charge_periods WHERE id = ${periodId}`;
    expect(period.formula.formula).toEqual({ mode: "equal" });
    expect(period.formula.units[0].occupants).toBe(1);
  });

  it("a month cannot be issued twice", async () => {
    const b = await makeBuilding(sql, 2);
    const args = { buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(1000), formula: { mode: "equal" } as Formula, by: b.userId };
    await issueCharge(sql, args);
    await expect(issueCharge(sql, args)).rejects.toMatchObject({ code: "already_issued" });
  });

  it("inactive units are left out; empty units owe nothing under by_occupants", async () => {
    const b = await makeBuilding(sql, 3);
    await sql`UPDATE units SET is_active = false WHERE id = ${b.unitIds[0]}`;
    await sql`UPDATE units SET occupants = 0 WHERE id = ${b.unitIds[1]}`;
    const { shares } = await issueCharge(sql, {
      buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(1000), formula: { mode: "by_occupants" }, by: b.userId,
    });
    expect(shares.map((s) => s.unitId)).toEqual([b.unitIds[1], b.unitIds[2]]);
    expect(await unitDebt(sql, b.unitIds[0])).toBe(0n);
    expect(await unitDebt(sql, b.unitIds[1])).toBe(0n);
    expect(await unitDebt(sql, b.unitIds[2])).toBe(toman(1000));
  });

  it("void and reissue a month: each unit owes only the new charge, with the reason on record", async () => {
    const b = await makeBuilding(sql, 3);
    const first = await issueCharge(sql, {
      buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(3_000_000), formula: { mode: "equal" }, by: b.userId,
    });
    await reissueCharge(sql, {
      periodId: first.periodId,
      reason: "مبلغ کل اشتباه وارد شده بود",
      totalRial: toman(2_400_000),
      formula: { mode: "equal" },
      by: b.userId,
    });

    for (const id of b.unitIds) expect(await unitDebt(sql, id)).toBe(toman(800_000));
    expect(await buildingBalance(sql, b.buildingId)).toBe(0n);

    const periods = await sql<{ voided: boolean }[]>`
      SELECT voided_at IS NOT NULL AS voided FROM charge_periods WHERE building_id = ${b.buildingId} ORDER BY issued_at`;
    expect(periods.map((p) => p.voided)).toEqual([true, false]);

    const rows = await loadLedger(sql, b.buildingId);
    const voided = rows.filter((r) => r.voided);
    expect(voided).toHaveLength(3);
    expect(voided[0].history.at(-1)?.reason).toBe("مبلغ کل اشتباه وارد شده بود");

    await expect(
      reissueCharge(sql, { periodId: first.periodId, reason: "دوباره", totalRial: toman(1000), formula: { mode: "equal" }, by: b.userId }),
    ).rejects.toBeInstanceOf(ChargeError);
  });
});
