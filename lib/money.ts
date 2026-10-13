// The only two places money is converted. Stored: BIGINT rial. Shown and typed: toman.

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Turns Persian and Arabic-Indic digits into Latin ones. */
export function normalizeDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const i = PERSIAN_DIGITS.indexOf(d);
    return String(i >= 0 ? i : ARABIC_DIGITS.indexOf(d));
  });
}

export class MoneyInputError extends Error {}

/** '۱٬۲۵۰٬۰۰۰' or '1,250,000' toman → 12500000n rial. Accepts either digit set and separators. */
export function tomanInputToRial(input: string): bigint {
  const cleaned = normalizeDigits(input).replace(/[\s,٬،'_]/g, "");
  if (!/^\d+$/.test(cleaned)) throw new MoneyInputError("مبلغ را فقط با عدد وارد کنید");
  const toman = BigInt(cleaned);
  if (toman === 0n) throw new MoneyInputError("مبلغ باید بیشتر از صفر باشد");
  return toman * 10n;
}

const formatter = new Intl.NumberFormat("fa-IR");
const signedFormatter = new Intl.NumberFormat("fa-IR", { signDisplay: "exceptZero" });

function toToman(rial: bigint): bigint {
  // The DB guarantees whole tomans; a remainder here means a bug upstream.
  if (rial % 10n !== 0n) throw new Error(`amount ${rial} rial is not a whole toman`);
  return rial / 10n;
}

/**
 * 12500000n rial → '۱٬۲۵۰٬۰۰۰ تومان'. Negatives use the Persian locale's own form, which
 * starts with a left-to-right mark so the minus stays beside the number in RTL text.
 */
export function rialToTomanLabel(rial: bigint): string {
  return `${formatter.format(toToman(rial))} تومان`;
}

/** Like rialToTomanLabel, but always shows the sign: '+۵۰۰٬۰۰۰ تومان', '−۱٬۲۰۰٬۰۰۰ تومان'. */
export function rialToSignedTomanLabel(rial: bigint): string {
  return `${signedFormatter.format(toToman(rial))} تومان`;
}
