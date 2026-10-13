import { describe, expect, it } from "vitest";
import { normalizeDigits, rialToSignedTomanLabel, rialToTomanLabel, tomanInputToRial } from "./money";
import { fromJalali, jalaliLabel, jalaliMonthRange, todayTehran } from "./date";

describe("money", () => {
  it("reads toman in Persian or Latin digits, with separators", () => {
    expect(tomanInputToRial("۱٬۲۵۰٬۰۰۰")).toBe(12_500_000n);
    expect(tomanInputToRial("1,250,000")).toBe(12_500_000n);
    expect(tomanInputToRial(" ١٢٥٠ ")).toBe(12_500n);
    expect(normalizeDigits("۱۲a3")).toBe("12a3");
  });

  it("rejects input that is not a positive whole number", () => {
    expect(() => tomanInputToRial("12.5")).toThrow();
    expect(() => tomanInputToRial("")).toThrow();
    expect(() => tomanInputToRial("۰")).toThrow();
  });

  it("shows rial as toman with Persian digits", () => {
    expect(rialToTomanLabel(12_500_000n)).toBe("۱٬۲۵۰٬۰۰۰ تومان");
    // LRM + minus: the Persian locale's form, keeps the sign left of the number in RTL text.
    expect(rialToTomanLabel(-85_000_000n)).toBe("\u200e−۸٬۵۰۰٬۰۰۰ تومان");
    expect(rialToSignedTomanLabel(5_000_000n)).toBe("\u200e+۵۰۰٬۰۰۰ تومان");
    expect(() => rialToTomanLabel(15n)).toThrow();
  });
});

describe("date", () => {
  it("shows Jalali dates with month names", () => {
    expect(jalaliLabel("2026-10-04")).toBe("۱۲ مهر ۱۴۰۵");
    expect(fromJalali(1405, 7, 12)).toBe("2026-10-04");
  });

  it("gets Esfand right in leap and common years", () => {
    const days = (r: { start: string; end: string }) => (Date.parse(r.end) - Date.parse(r.start)) / 86_400_000;
    expect(days(jalaliMonthRange(1403, 12))).toBe(30); // 1403 is a leap year
    expect(days(jalaliMonthRange(1404, 12))).toBe(29);
    expect(jalaliMonthRange(1403, 12).end).toBe("2025-03-21");
  });

  it("uses Tehran's date, not the server's", () => {
    // 22:00 UTC on Oct 13 is already Oct 14 in Tehran (UTC+3:30).
    expect(todayTehran(new Date("2026-10-13T22:00:00Z"))).toBe("2026-10-14");
  });
});
