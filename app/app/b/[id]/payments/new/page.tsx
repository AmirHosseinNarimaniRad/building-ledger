import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import { listUnits } from "@/lib/units";
import { rialToTomanLabel } from "@/lib/money";
import { jalaliInputValue, todayTehran } from "@/lib/date";
import { PageTitle } from "@/components/ui";
import { ReceiptForm } from "./receipt-form";

export default async function NewPaymentPage({ params, searchParams }: PageProps<"/app/b/[id]/payments/new">) {
  const { id } = await params;
  const { unit } = await searchParams;
  await requireBuilding(id);
  const units = (await listUnits(db(), id)).map((u) => ({
    id: u.id,
    label: u.label,
    residentName: u.residentName,
    debtLabel: u.debtRial > 0n ? rialToTomanLabel(u.debtRial) : null,
  }));
  return (
    <>
      <PageTitle>ثبت دریافتی</PageTitle>
      <ReceiptForm
        buildingId={id}
        units={units}
        today={jalaliInputValue(todayTehran())}
        preselectUnit={typeof unit === "string" ? unit : undefined}
      />
    </>
  );
}
