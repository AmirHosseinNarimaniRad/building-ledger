import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { resolveToken } from "@/lib/residents";
import { loadResidentView, type ResidentBill } from "@/lib/resident-view";
import { lockEntries } from "@/lib/ledger";
import { rialToTomanLabel } from "@/lib/money";
import { jalaliMonthName } from "@/lib/date";
import { normalizeDigits } from "@/lib/money";
import { LedgerRowView, type LedgerRowContext } from "@/components/ledger-row";
import { Card } from "@/components/ui";

export const metadata: Metadata = {
  title: "صورت‌حساب واحد — دفتر شفاف ساختمان",
  robots: { index: false, follow: false },
};

const fa = new Intl.NumberFormat("fa-IR");
const faPlain = new Intl.NumberFormat("fa-IR", { useGrouping: false });

/** Expired, revoked and unknown links all get exactly this page. */
function InvalidLink() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="max-w-sm text-center">
        <h1 className="mb-2 text-title font-bold">این لینک معتبر نیست</h1>
        <p className="text-label text-ink/70">برای دریافت لینک تازه با مدیر ساختمان تماس بگیرید.</p>
      </Card>
    </main>
  );
}

function parseMonth(m: unknown) {
  if (typeof m !== "string") return undefined;
  const match = /^(\d{4})-(\d{1,2})$/.exec(normalizeDigits(m));
  if (!match) return undefined;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  return jm >= 1 && jm <= 12 ? { jy, jm } : undefined;
}

function shiftMonth({ jy, jm }: { jy: number; jm: number }, by: number) {
  const i = jy * 12 + (jm - 1) + by;
  return { jy: Math.floor(i / 12), jm: (i % 12) + 1 };
}

function howCalculated(b: ResidentBill) {
  const f = b.formula;
  const n = fa.format(b.unitCount);
  const occ = `${fa.format(b.occupants)} نفر از ${fa.format(b.totalOccupants)} نفر ساکنان ساختمان`;
  switch (f.mode) {
    case "equal":
      return `تقسیم مساوی بین ${n} واحد`;
    case "by_area":
      return `به نسبت متراژ: ${fa.format(Number(b.areaM2))} متر از ${fa.format(b.totalAreaM2)} متر کل`;
    case "by_occupants":
      return `به نسبت نفرات: ${occ}`;
    case "mixed": {
      const fixed = f.fixedShareBp / 100;
      return `${fa.format(fixed)}٪ مساوی بین ${n} واحد، ${fa.format(100 - fixed)}٪ به نسبت نفرات (${occ})`;
    }
  }
}

export default async function ResidentPage({ params, searchParams }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const { m } = await searchParams;
  const link = await resolveToken(db(), token);
  if (!link) return <InvalidLink />;

  const view = await loadResidentView(db(), { unitId: link.unitId, buildingId: link.buildingId, month: parseMonth(m) });
  // Whatever a resident has seen can no longer change silently.
  await lockEntries(db(), view.shownEntryIds);

  const ctx: LedgerRowContext = {
    // Only this unit's own label is ever passed to the rows.
    unitLabels: new Map([[link.unitId, view.unitLabel]]),
    people: view.people,
    docs: view.docs,
    docHref: (docId) => `/r/${token}/doc/${docId}`,
    hideDraft: true,
  };
  const prev = shiftMonth(view.month, -1);
  const next = shiftMonth(view.month, 1);
  const monthTitle = `${jalaliMonthName(view.month.jm)} ${faPlain.format(view.month.jy)}`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <header>
        <div className="text-small text-ink/60">{view.buildingName}</div>
        <h1 className="text-title font-bold">واحد {view.unitLabel}</h1>
      </header>

      {/* 1. This unit's current debt */}
      <Card className={view.debtRial > 0n ? "border-danger/30" : "border-good/30"}>
        <div className="text-label text-ink/70">{view.debtRial > 0n ? "بدهی فعلی شما" : "بدهی ندارید"}</div>
        <div className={`num text-amount font-bold ${view.debtRial > 0n ? "text-danger" : "text-good"}`}>
          {rialToTomanLabel(view.debtRial > 0n ? view.debtRial : -view.debtRial)}
        </div>
        {view.debtRial < 0n && <div className="text-small text-ink/60">بستانکار هستید</div>}
      </Card>

      {/* 2. This month's bill and how it was worked out */}
      {view.bill && (
        <Card>
          <h2 className="mb-2 font-semibold">
            شارژ {jalaliMonthName(view.bill.jm)} {faPlain.format(view.bill.jy)}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-label">
            <dt className="text-ink/60">سهم شما</dt>
            <dd className="num font-bold">{rialToTomanLabel(view.bill.shareRial)}</dd>
            <dt className="text-ink/60">شارژ کل ساختمان</dt>
            <dd className="num">{rialToTomanLabel(view.bill.totalRial)}</dd>
            <dt className="text-ink/60">نحوه محاسبه</dt>
            <dd>{howCalculated(view.bill)}</dd>
          </dl>
        </Card>
      )}

      {/* 5. Fund balance and documentation ratio */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-label text-ink/70">مانده صندوق ساختمان</div>
          <div className="num text-title font-bold">{rialToTomanLabel(view.balanceRial)}</div>
        </Card>
        <Card>
          <div className="text-label text-ink/70">هزینه‌های مستند {jalaliMonthName(view.month.jm)}</div>
          <div className="num text-title font-bold">
            {view.expenses === 0 ? "—" : `${fa.format(view.documented)} از ${fa.format(view.expenses)}`}
          </div>
        </Card>
      </div>

      {/* 3 & 4. The building's spending this month, with document labels and images */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">هزینه‌ها و درآمدهای ساختمان — {monthTitle}</h2>
        </div>
        <nav className="flex justify-between text-label">
          <Link href={`/r/${token}?m=${prev.jy}-${prev.jm}`} className="text-primary underline">
            ماه قبل
          </Link>
          <Link href={`/r/${token}?m=${next.jy}-${next.jm}`} className="text-primary underline">
            ماه بعد
          </Link>
        </nav>
        {view.buildingRows.length === 0 ? (
          <p className="text-label text-ink/60">در این ماه چیزی ثبت نشده.</p>
        ) : (
          view.buildingRows.map((row) => <LedgerRowView key={row.entry.id} row={row} ctx={ctx} />)
        )}
      </section>

      {view.ownRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">حساب واحد شما</h2>
          {view.ownRows.map((row) => (
            <LedgerRowView key={row.entry.id} row={row} ctx={ctx} />
          ))}
        </section>
      )}

      <footer className="pb-6 pt-2 text-center text-small text-ink/50">
        هر رکوردی که اینجا دیدید، بی‌صدا تغییر نمی‌کند؛ هر اصلاحی با مقدار قبل و دلیلش نشان داده می‌شود.
      </footer>
    </main>
  );
}
