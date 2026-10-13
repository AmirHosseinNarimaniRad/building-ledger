import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { getUnit } from "@/lib/units";
import { displayMobile } from "@/lib/phone";
import { requireBuilding } from "@/lib/auth/session";
import { Card, PageTitle } from "@/components/ui";
import { updateUnitAction } from "../actions";
import { UnitForm } from "../unit-form";

export default async function EditUnitPage({ params }: PageProps<"/app/b/[id]/units/[unitId]">) {
  const { id, unitId } = await params;
  await requireBuilding(id);
  const unit = isUuid(unitId) ? await getUnit(db(), id, unitId) : null;
  if (!unit) notFound();

  return (
    <>
      <PageTitle>ویرایش واحد {unit.label}</PageTitle>
      <Card>
        <UnitForm
          action={updateUnitAction.bind(null, id, unitId)}
          submitLabel="ذخیره"
          showActive
          defaults={{
            label: unit.label,
            area: unit.areaM2 ?? "",
            occupants: String(unit.occupants),
            residentName: unit.residentName ?? "",
            phone: unit.phone ? displayMobile(unit.phone) : "",
            isActive: unit.isActive,
          }}
        />
        <p className="mt-3 text-small text-ink/60">
          اگر شماره موبایل عوض شود، لینک قبلی ساکن باطل می‌شود. دفتر مالی این واحد تغییر نمی‌کند.
        </p>
      </Card>
    </>
  );
}
