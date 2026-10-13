import Link from "next/link";
import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import { loadLedgerPage } from "@/lib/ledger-page";
import { LedgerRowView } from "@/components/ledger-row";
import { buttonStyles, PageTitle } from "@/components/ui";
import type { LedgerRow } from "@/lib/ledger";

const FILTERS = {
  all: { label: "همه", test: () => true },
  expense: { label: "هزینه‌ها", test: (r: LedgerRow) => r.entry.kind === "expense" },
  in: { label: "دریافتی‌ها", test: (r: LedgerRow) => r.entry.kind === "payment" || r.entry.kind === "income" },
  charge: { label: "شارژها", test: (r: LedgerRow) => r.entry.kind === "charge_issued" },
} as const;

export default async function LedgerPage({ params, searchParams }: PageProps<"/app/b/[id]/ledger">) {
  const { id } = await params;
  const { f } = await searchParams;
  await requireBuilding(id);
  const filter = typeof f === "string" && f in FILTERS ? (f as keyof typeof FILTERS) : "all";

  const page = await loadLedgerPage(db(), id);
  const rows = page.rows.filter(FILTERS[filter].test);
  const ctx = { ...page, docHref: (docId: string) => `/api/documents/${docId}` };
  const base = `/app/b/${id}`;

  return (
    <>
      <PageTitle
        action={
          <div className="flex gap-2">
            <Link href={`${base}/expenses/new`} className={buttonStyles.primary}>
              ثبت هزینه
            </Link>
            <Link href={`${base}/payments/new`} className={buttonStyles.secondary}>
              ثبت دریافتی
            </Link>
          </div>
        }
      >
        دفتر
      </PageTitle>

      <nav className="mb-3 flex gap-2 text-label">
        {Object.entries(FILTERS).map(([k, v]) => (
          <Link
            key={k}
            href={k === "all" ? `${base}/ledger` : `${base}/ledger?f=${k}`}
            className={`rounded-full px-3 py-1 ${k === filter ? "bg-ink text-background" : "bg-neutral"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-ink/60">هنوز چیزی ثبت نشده.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const e = row.entry;
            const editable = !row.voided && ["expense", "income", "payment"].includes(e.kind);
            const needsDoc = editable && e.kind === "expense" && row.docState !== "documented";
            return (
              <LedgerRowView
                key={e.id}
                row={row}
                ctx={ctx}
                actions={
                  editable ? (
                    <>
                      <Link href={`${base}/ledger/${e.id}`} className="text-primary underline">
                        ویرایش
                      </Link>
                      {needsDoc && (
                        <Link href={`${base}/ledger/${e.id}/document`} className="text-primary underline">
                          افزودن سند
                        </Link>
                      )}
                    </>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}
