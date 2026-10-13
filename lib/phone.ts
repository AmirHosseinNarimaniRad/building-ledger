import { normalizeDigits } from "./money";

/**
 * Iranian mobile numbers in any common form → E.164 (+989XXXXXXXXX), or null if invalid.
 * Accepts 0912..., 912..., +98912..., 0098912..., with Persian digits, spaces or dashes.
 */
export function normalizeMobile(input: string): string | null {
  let d = normalizeDigits(input).replace(/[\s\-()]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("0098")) d = d.slice(2);
  if (d.startsWith("98")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return /^9\d{9}$/.test(d) ? `+98${d}` : null;
}

/** +989121234567 → 09121234567, the way Iranians write it. */
export function displayMobile(e164: string): string {
  return e164.startsWith("+98") ? `0${e164.slice(3)}` : e164;
}
