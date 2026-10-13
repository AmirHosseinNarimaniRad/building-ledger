import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { requireBuilding } from "@/lib/auth/session";
import { toJalali, todayTehran } from "@/lib/date";
import { PageTitle } from "@/components/ui";
import { ChargeForm } from "./charge-form";

export default async function NewChargePage({ params, searchParams }: PageProps<"/app/b/[id]/charges/new">) {
  const { id } = await params;
  const { reissue } = await searchParams;
  await requireBuilding(id);

  let period: { periodId: string; jy: number; jm: number } | undefined;
  if (typeof reissue === "string") {
    const [p] = isUuid(reissue)
      ? await db()<{ jalaliYear: number; jalaliMonth: number }[]>`
          SELECT jalali_year, jalali_month FROM charge_periods
          WHERE id = ${reissue} AND building_id = ${id} AND voided_at IS NULL`
      : [];
    if (!p) notFound();
    period = { periodId: reissue, jy: p.jalaliYear, jm: p.jalaliMonth };
  }

  const { jy, jm } = toJalali(todayTehran());
  return (
    <>
      <PageTitle>{period ? "اصلاح شارژ صادرشده" : "صدور شارژ ماه"}</PageTitle>
      <ChargeForm buildingId={id} current={{ jy, jm }} reissue={period} />
    </>
  );
}
