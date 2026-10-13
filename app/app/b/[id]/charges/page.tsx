import Link from "next/link";
import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import { jalaliDateTimeLabel, jalaliMonthName } from "@/lib/date";
import { rialToTomanLabel } from "@/lib/money";
import type { FormulaSnapshot } from "@/lib/charge";
import { Badge } from "@/components/badges";
import { Alert, buttonStyles, Card, PageTitle } from "@/components/ui";

const fa = new Intl.NumberFormat("fa-IR");
const faPlain = new Intl.NumberFormat("fa-IR", { useGrouping: false });

function formulaLabel(f: FormulaSnapshot["formula"]) {
  switch (f.mode) {
    case "equal":
      return "مساوی";
    case "by_area":
      return "به نسبت متراژ";
    case "by_occupants":
      return "به نسبت نفرات";
    case "mixed":
      return `${fa.format(f.fixedShareBp / 100)}٪ ثابت + نفرات`;
  }
}

export default async function ChargesPage({ params, searchParams }: PageProps<"/app/b/[id]/charges">) {
  const { id } = await params;
  const { sent } = await searchParams;
  await requireBuilding(id);
  const periods = await db()<
    { id: string; jalaliYear: number; jalaliMonth: number; totalRial: bigint; formula: FormulaSnapshot; issuedAt: Date; voidedAt: Date | null }[]
  >`
    SELECT id, jalali_year, jalali_month, total_rial, formula, issued_at, voided_at FROM charge_periods
    WHERE building_id = ${id} ORDER BY jalali_year DESC, jalali_month DESC, issued_at DESC`;

  return (
    <>
      <PageTitle
        action={
          <Link href={`/app/b/${id}/charges/new`} className={buttonStyles.primary}>
            صدور شارژ ماه
          </Link>
        }
      >
        شارژها
      </PageTitle>
      {typeof sent === "string" && (
        <div className="mb-3">
          <Alert tone="good">شارژ صادر شد و برای {fa.format(Number(sent))} واحد پیامک فرستاده شد.</Alert>
        </div>
      )}
      {periods.length === 0 ? (
        <p className="text-ink/60">هنوز شارژی صادر نشده.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {periods.map((p) => (
            <Card key={p.id} className={p.voidedAt ? "opacity-60" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {jalaliMonthName(p.jalaliMonth)} {faPlain.format(p.jalaliYear)}
                  </div>
                  <div className="text-small text-ink/60">
                    {formulaLabel(p.formula.formula)} · صادر شده {jalaliDateTimeLabel(p.issuedAt)}
                  </div>
                </div>
                <div className="num font-bold">{rialToTomanLabel(p.totalRial)}</div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-label">
                {p.voidedAt ? (
                  <Badge tone="danger">باطل و دوباره صادر شده</Badge>
                ) : (
                  <Link href={`/app/b/${id}/charges/new?reissue=${p.id}`} className="text-primary underline">
                    اصلاح (صدور دوباره)
                  </Link>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
