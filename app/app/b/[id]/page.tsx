import Link from "next/link";
import { db } from "@/lib/db";
import { dashboard } from "@/lib/buildings";
import { rialToTomanLabel } from "@/lib/money";
import { requireBuilding } from "@/lib/auth/session";
import { buttonStyles, Card } from "@/components/ui";

const fa = new Intl.NumberFormat("fa-IR");

export default async function DashboardPage({ params }: PageProps<"/app/b/[id]">) {
  const { id } = await params;
  await requireBuilding(id);
  const d = await dashboard(db(), id);

  if (d.unitCount === 0) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p>هنوز واحدی ثبت نشده. اول واحدهای ساختمان را وارد کنید.</p>
        <Link href={`/app/b/${id}/units/bulk`} className={buttonStyles.primary}>
          ورود واحدها
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/app/b/${id}/expenses/new`} className={buttonStyles.primary}>
          ثبت هزینه
        </Link>
        <Link href={`/app/b/${id}/payments/new`} className={buttonStyles.secondary}>
          ثبت دریافتی
        </Link>
      </div>
      <Card className="bg-primary text-background">
        <div className="text-label opacity-80">مانده صندوق</div>
        <div className="num text-amount font-bold">{rialToTomanLabel(d.balanceRial)}</div>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Link href={`/app/b/${id}/arrears`} className="rounded-2xl border border-ink/10 p-4 hover:border-danger">
          <div className="text-label text-ink/70">معوقات</div>
          <div className="num text-title font-bold text-danger">{rialToTomanLabel(d.arrearsRial)}</div>
          <div className="text-small text-ink/60">{fa.format(d.unitsOwing)} واحد بدهکار</div>
        </Link>
        <Card>
          <div className="text-label text-ink/70">مستندسازی این ماه</div>
          <div className="num text-title font-bold">
            {d.expenses === 0 ? "—" : `${fa.format(d.documented)} از ${fa.format(d.expenses)}`}
          </div>
          <div className="text-small text-ink/60">هزینه با سند</div>
        </Card>
      </div>
    </div>
  );
}
