import Link from "next/link";
import { db } from "@/lib/db";
import { listUnits } from "@/lib/units";
import { rialToTomanLabel } from "@/lib/money";
import { displayMobile } from "@/lib/phone";
import { requireBuilding } from "@/lib/auth/session";
import { buttonStyles, Card, PageTitle } from "@/components/ui";
import { addUnitAction } from "./actions";
import { UnitForm } from "./unit-form";

const fa = new Intl.NumberFormat("fa-IR");

export default async function UnitsPage({ params }: PageProps<"/app/b/[id]/units">) {
  const { id } = await params;
  await requireBuilding(id);
  const units = await listUnits(db(), id);

  return (
    <>
      <PageTitle
        action={
          <Link href={`/app/b/${id}/units/bulk`} className={buttonStyles.secondary}>
            ورود سریع چند واحد
          </Link>
        }
      >
        واحدها ({fa.format(units.length)})
      </PageTitle>

      <details className="mb-4 rounded-2xl border border-ink/10 p-4" open={units.length === 0}>
        <summary className="cursor-pointer font-semibold">افزودن یک واحد</summary>
        <div className="mt-4">
          <UnitForm action={addUnitAction.bind(null, id)} submitLabel="افزودن واحد" />
        </div>
      </details>

      {units.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-label">
            <thead className="bg-neutral text-right">
              <tr>
                <th className="p-2">واحد</th>
                <th className="p-2">متراژ</th>
                <th className="p-2">نفرات</th>
                <th className="p-2">ساکن</th>
                <th className="p-2">بدهی</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className={`border-t border-ink/10 ${u.isActive ? "" : "opacity-50"}`}>
                  <td className="p-2 font-semibold">{u.label}</td>
                  <td className="num p-2">{u.areaM2 ? fa.format(Number(u.areaM2)) : "—"}</td>
                  <td className="num p-2">{u.occupants === 0 ? "خالی" : fa.format(u.occupants)}</td>
                  <td className="p-2">
                    <div>{u.residentName ?? "—"}</div>
                    {u.phone && (
                      <div dir="ltr" className="text-right text-small text-ink/60">
                        {displayMobile(u.phone)}
                      </div>
                    )}
                  </td>
                  <td className={`num p-2 ${u.debtRial > 0n ? "text-danger" : ""}`}>
                    {u.debtRial === 0n ? "—" : rialToTomanLabel(u.debtRial)}
                  </td>
                  <td className="p-2 text-left">
                    <Link href={`/app/b/${id}/units/${u.id}`} className="text-primary underline">
                      ویرایش
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
