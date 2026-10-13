import { requireBuilding } from "@/lib/auth/session";
import { PageTitle } from "@/components/ui";
import { BulkGrid } from "./bulk-grid";

export default async function BulkUnitsPage({ params }: PageProps<"/app/b/[id]/units/bulk">) {
  const { id } = await params;
  await requireBuilding(id);
  return (
    <>
      <PageTitle>ورود سریع واحدها</PageTitle>
      <BulkGrid buildingId={id} />
    </>
  );
}
