import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { requireBuilding } from "@/lib/auth/session";
import { loadLedger } from "@/lib/ledger";
import { jalaliInputValue } from "@/lib/date";
import { PageTitle } from "@/components/ui";
import { EditForm } from "./edit-form";

const fa = new Intl.NumberFormat("fa-IR", { useGrouping: false });

export default async function EditEntryPage({ params }: PageProps<"/app/b/[id]/ledger/[entryId]">) {
  const { id, entryId } = await params;
  await requireBuilding(id);
  if (!isUuid(entryId)) notFound();

  // Only the latest version of a live row can be edited.
  const row = (await loadLedger(db(), id)).find((r) => r.entry.id === entryId);
  const e = row?.entry;
  if (!row || !e || row.voided || !(e.kind === "expense" || e.kind === "income" || e.kind === "payment")) notFound();

  const locked = e.locked ?? true;
  return (
    <>
      <PageTitle>ویرایش «{e.title}»</PageTitle>
      <EditForm
        buildingId={id}
        entryId={entryId}
        locked={locked}
        defaults={{
          kind: e.kind,
          amount: fa.format((e.amountRial ?? 0n) / 10n),
          title: e.title,
          date: jalaliInputValue(e.occurredOn),
          note: e.note ?? e.undocumentedNote ?? "",
          docState: row.docState,
        }}
      />
    </>
  );
}
