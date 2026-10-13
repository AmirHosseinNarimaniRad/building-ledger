import Link from "next/link";
import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import { monthlyReport } from "@/lib/report";
import { rialToTomanLabel, normalizeDigits } from "@/lib/money";
import { jalaliLabel, jalaliMonthName, toJalali, todayTehran } from "@/lib/date";
import { DocBadge } from "@/components/badges";
import { Card } from "@/components/ui";
import { PrintButton } from "./print-button";

const fa = new Intl.NumberFormat("fa-IR");
const faPlain = new Intl.NumberFormat("fa-IR", { useGrouping: false });

function parseMonth(m: unknown) {
  const match = typeof m === "string" ? /^(\d{4})-(\d{1,2})$/.exec(normalizeDigits(m)) : null;
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return { jy: Number(match[1]), jm: Number(match[2]) };
  const { jy, jm } = toJalali(todayTehran());
  return { jy, jm };
}

function shift({ jy, jm }: { jy: number; jm: number }, by: number) {
  const i = jy * 12 + jm - 1 + by;
  return `${Math.floor(i / 12)}-${(i % 12) + 1}`;
}

function Line({ label, value, strong, tone }: { label: string; value: bigint; strong?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-1 ${strong ? "border-t border-ink/20 pt-2 font-bold" : ""}`}>
      <span>{label}</span>
      <span className={`num ${tone ?? ""}`}>{rialToTomanLabel(value)}</span>
    </div>
  );
}

export default async function ReportPage({ params, searchParams }: PageProps<"/app/b/[id]/report">) {
  const { id } = await params;
  const { m } = await searchParams;
  const { building } = await requireBuilding(id);
  const month = parseMonth(m);
  const r = await monthlyReport(db(), id, month.jy, month.jm);
  const title = `${jalaliMonthName(r.jm)} ${faPlain.format(r.jy)}`;

  return (
    <article className="flex flex-col gap-4 print:gap-3 print:text-[12pt]">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <nav className="flex gap-3 text-label">
          <Link href={`/app/b/${id}/report?m=${shift(month, -1)}`} className="text-primary underline">
            ماه قبل
          </Link>
          <Link href={`/app/b/${id}/report?m=${shift(month, 1)}`} className="text-primary underline">
            ماه بعد
          </Link>
        </nav>
        <PrintButton />
      </div>

      <header>
        <div className="text-small text-ink/60">{building.name}</div>
        <h1 className="text-title font-bold">گزارش مالی {title}</h1>
        <div className="text-small text-ink/60">تهیه‌شده در {jalaliLabel(todayTehran())}</div>
      </header>

      <Card className="print:border-ink/30">
        <Line label="مانده صندوق در ابتدای ماه" value={r.openingRial} />
        <Line label="شارژ دریافت‌شده از واحدها" value={r.collectedRial} tone="text-good" />
        <Line label="درآمدهای دیگر" value={r.otherIncomeRial} tone="text-good" />
        <Line label="هزینه‌ها" value={-r.expensesRial} tone="text-danger" />
        <Line label="مانده صندوق در پایان ماه" value={r.closingRial} strong />
      </Card>

      <div className="grid grid-cols-3 gap-3 text-label">
        <Card className="print:border-ink/30">
          <div className="text-ink/70">شارژ صادرشده</div>
          <div className="num font-bold">{rialToTomanLabel(r.chargedRial)}</div>
        </Card>
        <Card className="print:border-ink/30">
          <div className="text-ink/70">معوقات امروز</div>
          <div className="num font-bold text-danger">{rialToTomanLabel(r.arrearsRial)}</div>
        </Card>
        <Card className="print:border-ink/30">
          <div className="text-ink/70">هزینه‌های مستند</div>
          <div className="num font-bold">
            {r.expenseCount === 0 ? "—" : `${fa.format(r.documented)} از ${fa.format(r.expenseCount)}`}
          </div>
        </Card>
      </div>

      <section className="break-inside-avoid-page">
        <h2 className="mb-2 font-semibold">هزینه‌ها</h2>
        {r.expenseRows.length === 0 ? (
          <p className="text-label text-ink/60">هزینه‌ای ثبت نشده.</p>
        ) : (
          <table className="w-full text-label">
            <thead className="bg-neutral print:bg-transparent">
              <tr className="text-right">
                <th className="p-2">تاریخ</th>
                <th className="p-2">بابت</th>
                <th className="p-2">سند</th>
                <th className="p-2 text-left">مبلغ</th>
              </tr>
            </thead>
            <tbody>
              {r.expenseRows.map((row) => (
                <tr key={row.entry.id} className={`border-t border-ink/10 ${row.voided ? "text-ink/40 line-through" : ""}`}>
                  <td className="whitespace-nowrap p-2">{jalaliLabel(row.entry.occurredOn)}</td>
                  <td className="p-2">
                    {row.entry.title}
                    {row.edited && <span className="text-small text-primary"> (ویرایش شده)</span>}
                    {row.voided && <span className="text-small"> (حذف شده)</span>}
                  </td>
                  <td className="p-2">{row.docState && <DocBadge state={row.docState} />}</td>
                  <td className="num whitespace-nowrap p-2 text-left">{rialToTomanLabel(row.entry.amountRial ?? 0n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {r.incomeRows.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">درآمدهای دیگر</h2>
          <table className="w-full text-label">
            <tbody>
              {r.incomeRows.map((row) => (
                <tr key={row.entry.id} className={`border-t border-ink/10 ${row.voided ? "text-ink/40 line-through" : ""}`}>
                  <td className="whitespace-nowrap p-2">{jalaliLabel(row.entry.occurredOn)}</td>
                  <td className="p-2">{row.entry.title}</td>
                  <td className="num whitespace-nowrap p-2 text-left">{rialToTomanLabel(row.entry.amountRial ?? 0n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="text-small text-ink/50">
        مبالغ به تومان. ردیف‌های ویرایش‌شده و حذف‌شده با تاریخچه کامل در دفتر ساختمان قابل مشاهده‌اند.
      </footer>
    </article>
  );
}
