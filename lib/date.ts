// Stored: Gregorian 'YYYY-MM-DD'. Shown: Jalali. All "today" math is in Asia/Tehran.
import { isValidJalaaliDate, toGregorian, toJalaali } from "jalaali-js";
import { normalizeDigits } from "./money";

export const TIME_ZONE = "Asia/Tehran";

const MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const digits = new Intl.NumberFormat("fa-IR", { useGrouping: false });
const isoInTehran = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parseIso(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  return { gy: Number(m[1]), gm: Number(m[2]), gd: Number(m[3]) };
}

/** Today's date in Tehran, never the server's timezone. */
export function todayTehran(now: Date = new Date()): string {
  return isoInTehran.format(now);
}

export function toJalali(iso: string) {
  const { gy, gm, gd } = parseIso(iso);
  return toJalaali(gy, gm, gd);
}

export function fromJalali(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

export function jalaliMonthName(jm: number): string {
  return MONTHS[jm - 1];
}

/** '2026-10-04' → '۱۲ مهر ۱۴۰۵' */
export function jalaliLabel(iso: string): string {
  const { jy, jm, jd } = toJalali(iso);
  return `${digits.format(jd)} ${jalaliMonthName(jm)} ${digits.format(jy)}`;
}

/** Gregorian range of a Jalali month: start inclusive, end exclusive. */
export function jalaliMonthRange(jy: number, jm: number): { start: string; end: string } {
  const start = fromJalali(jy, jm, 1);
  const end = jm === 12 ? fromJalali(jy + 1, 1, 1) : fromJalali(jy, jm + 1, 1);
  return { start, end };
}

/** '2026-10-13' → '۱۴۰۵/۰۷/۲۱', for prefilling a Jalali date field. */
export function jalaliInputValue(iso: string): string {
  const { jy, jm, jd } = toJalali(iso);
  return `${digits.format(jy)}/${digits.format(jm).padStart(2, "۰")}/${digits.format(jd).padStart(2, "۰")}`;
}

/** '۱۴۰۵/۷/۲۱' or '1405-07-21' (any digits) → '2026-10-13', or null if it isn't a real date. */
export function parseJalaliInput(input: string): string | null {
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(normalizeDigits(input).trim());
  if (!m) return null;
  const [jy, jm, jd] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  return fromJalali(jy, jm, jd);
}

const dateTime = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A moment as Tehran sees it: '۲۰ مهر، ۱۸:۰۵'. */
export function jalaliDateTimeLabel(at: Date): string {
  return dateTime.format(at);
}
