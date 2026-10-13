// Charge math. A one-toman error on a bill costs the product its credibility, so:
// the shares always add up to the total exactly, and the result never depends on input order.

/** Shares are whole tomans so the toman labels residents see add up too. */
export const STEP = 10n;

export type Formula =
  | { mode: "equal" }
  | { mode: "by_area" }
  | { mode: "by_occupants" }
  /** Part split equally (elevator, guard), the rest by occupants (water, cleaning). Basis points: 4000 = 40%. */
  | { mode: "mixed"; fixedShareBp: number };

export interface ChargeUnit {
  id: string;
  label: string;
  sortKey: number;
  /** NUMERIC(8,2) as Postgres returns it, e.g. '92.50'. */
  areaM2: string | null;
  occupants: number;
}

export type ChargeErrorCode =
  | "invalid_total"
  | "invalid_formula"
  | "no_units"
  | "missing_area"
  | "zero_weight"
  | "already_issued"
  | "not_found";

export class ChargeError extends Error {
  constructor(
    readonly code: ChargeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Splits totalRial by weight. Each unit gets its floor share; leftover tomans go one at a
 * time in sort_key order, only to units with weight > 0.
 */
export function splitCharge(totalRial: bigint, weights: bigint[], sortKeys: number[]): bigint[] {
  if (totalRial % STEP !== 0n) throw new Error("total must be a whole toman");
  const total = totalRial / STEP;
  const sumW = weights.reduce((a, b) => a + b, 0n);
  if (sumW === 0n) throw new Error("total weight is zero");

  // 1. Base share: integer division, rounded down.
  const shares = weights.map((w) => (total * w) / sumW);

  // 2. Hand out the remainder one toman at a time, in sort_key order, weight > 0 only.
  let remainder = total - shares.reduce((a, b) => a + b, 0n);
  const order = sortKeys
    .map((k, i) => ({ k, i }))
    .filter((x) => weights[x.i] > 0n)
    .sort((a, b) => a.k - b.k)
    .map((x) => x.i);

  for (let j = 0; remainder > 0n; j++, remainder--) {
    shares[order[j % order.length]] += 1n;
  }
  return shares.map((s) => s * STEP);
}

/** '92.5' or '92.50' → 9250n, exactly (no floating point). */
function areaWeight(area: string): bigint {
  const [whole, frac = ""] = area.split(".");
  return BigInt(whole + frac.padEnd(2, "0").slice(0, 2));
}

function weightsFor(units: ChargeUnit[], mode: "equal" | "by_area" | "by_occupants"): bigint[] {
  if (mode === "equal") return units.map(() => 1n);
  if (mode === "by_occupants") {
    const w = units.map((u) => BigInt(u.occupants));
    if (w.every((x) => x === 0n)) {
      throw new ChargeError("zero_weight", "تعداد ساکنان همه واحدها صفر است؛ تقسیم بر اساس نفرات ممکن نیست");
    }
    return w;
  }
  const missing = units.filter((u) => u.areaM2 === null);
  if (missing.length) {
    throw new ChargeError(
      "missing_area",
      `متراژ این واحدها وارد نشده: ${missing.map((u) => u.label).join("، ")}`,
    );
  }
  return units.map((u) => areaWeight(u.areaM2!));
}

function validate(totalRial: bigint, formula: Formula) {
  if (totalRial <= 0n || totalRial % STEP !== 0n) {
    throw new ChargeError("invalid_total", "مبلغ کل باید عددی مثبت و بر حسب تومان کامل باشد");
  }
  if (formula.mode === "mixed") {
    const bp = formula.fixedShareBp;
    if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) {
      throw new ChargeError("invalid_formula", "سهم ثابت باید بین ۰ تا ۱۰۰ درصد باشد");
    }
  } else if (!["equal", "by_area", "by_occupants"].includes(formula.mode)) {
    throw new ChargeError("invalid_formula", "فرمول شارژ نامعتبر است");
  }
}

/** Each active unit's share of totalRial, in the order given. Sum is exactly totalRial. */
export function computeShares(units: ChargeUnit[], totalRial: bigint, formula: Formula): bigint[] {
  validate(totalRial, formula);
  if (units.length === 0) throw new ChargeError("no_units", "هیچ واحد فعالی برای تقسیم شارژ نیست");
  const sortKeys = units.map((u) => u.sortKey);

  if (formula.mode !== "mixed") {
    return splitCharge(totalRial, weightsFor(units, formula.mode), sortKeys);
  }

  // Fixed part rounded down to a whole toman; the variable part is the rest.
  const fixed = ((totalRial / STEP) * BigInt(formula.fixedShareBp)) / 10_000n * STEP;
  const variable = totalRial - fixed;
  const zeros = units.map(() => 0n);
  const fixedShares = fixed > 0n ? splitCharge(fixed, weightsFor(units, "equal"), sortKeys) : zeros;
  const variableShares =
    variable > 0n ? splitCharge(variable, weightsFor(units, "by_occupants"), sortKeys) : zeros;
  return units.map((_, i) => fixedShares[i] + variableShares[i]);
}
