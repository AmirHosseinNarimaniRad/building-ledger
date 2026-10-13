import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { requireBuilding } from "@/lib/auth/session";
import { loadLedger } from "@/lib/ledger";
import { rialToTomanLabel } from "@/lib/money";
import { PageTitle } from "@/components/ui";
import { DocumentForm } from "./document-form";

export default async function AttachDocumentPage({ params }: PageProps<"/app/b/[id]/ledger/[entryId]/document">) {
  const { id, entryId } = await params;
  await requireBuilding(id);
  if (!isUuid(entryId)) notFound();
  const row = (await loadLedger(db(), id)).find((r) => r.entry.id === entryId);
  if (!row || row.voided || row.entry.kind !== "expense") notFound();

  return (
    <>
      <PageTitle>افزودن سند</PageTitle>
      <p className="mb-3 text-label text-ink/70">
        {row.entry.title} — <span className="num">{rialToTomanLabel(row.entry.amountRial ?? 0n)}</span>
      </p>
      <DocumentForm buildingId={id} entryId={entryId} />
    </>
  );
}
