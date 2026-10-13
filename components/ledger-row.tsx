import type { ReactNode } from "react";
import type { LedgerRow } from "@/lib/ledger";
import type { DocumentRef } from "@/lib/documents";
import { rialToSignedTomanLabel, rialToTomanLabel } from "@/lib/money";
import { jalaliDateTimeLabel, jalaliLabel } from "@/lib/date";
import { Badge, DocBadge } from "./badges";

const fa = new Intl.NumberFormat("fa-IR");

export interface LedgerRowContext {
  unitLabels: Map<string, string>;
  people: Map<string, string>;
  docs: Map<string, DocumentRef[]>;
  /** Where a document image is served from, e.g. '/api/documents'. */
  docHref: (docId: string) => string;
  /** Residents never see the draft countdown: what they view is locked as they view it. */
  hideDraft?: boolean;
}

function amountView(row: LedgerRow) {
  const a = row.entry.amountRial ?? 0n;
  switch (row.entry.kind) {
    case "expense":
      return <span className="text-danger">{rialToSignedTomanLabel(-a)}</span>;
    case "income":
    case "payment":
      return <span className="text-good">{rialToSignedTomanLabel(a)}</span>;
    default:
      return <span>{rialToTomanLabel(a)}</span>;
  }
}

/**
 * One ledger row with its badges and full change history.
 * Used by the manager's ledger and the resident page alike: the history is never summarized
 * or hidden for residents — that is the product.
 */
export function LedgerRowView({ row, ctx, actions }: { row: LedgerRow; ctx: LedgerRowContext; actions?: ReactNode }) {
  const e = row.entry;
  const draftLeft = ctx.hideDraft ? 0 : (e.draftMinutesLeft ?? 0);
  const unit = e.unitId ? ctx.unitLabels.get(e.unitId) : undefined;
  const docs = row.entryIds.flatMap((id) => ctx.docs.get(id) ?? []);

  return (
    <article className={`rounded-2xl border border-ink/10 p-3 ${row.voided ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={`font-semibold ${row.voided ? "line-through" : ""}`}>{e.title}</div>
          <div className="text-small text-ink/60">
            {jalaliLabel(e.occurredOn)}
            {unit && e.kind === "charge_issued" ? ` · واحد ${unit}` : ""}
          </div>
        </div>
        <div className={`num shrink-0 font-bold ${row.voided ? "line-through" : ""}`}>{amountView(row)}</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {e.kind === "expense" && row.docState && <DocBadge state={row.docState} />}
        {e.kind === "charge_issued" && <Badge tone="neutral">شارژ</Badge>}
        {e.kind === "payment" && <Badge tone="good">پرداخت</Badge>}
        {e.kind === "income" && <Badge tone="good">درآمد</Badge>}
        {row.edited && <Badge tone="primary">ویرایش شده</Badge>}
        {row.voided && <Badge tone="danger">حذف شده</Badge>}
        {draftLeft > 0 && !row.voided && (
          <Badge tone="neutral">تا {fa.format(draftLeft)} دقیقه قابل ویرایش</Badge>
        )}
      </div>

      {(e.note || e.undocumentedNote) && (
        <p className="mt-2 text-label text-ink/80">{e.note ?? e.undocumentedNote}</p>
      )}

      {docs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {docs.map((d, i) => (
            <a key={d.id} href={ctx.docHref(d.id)} target="_blank" rel="noopener" className="text-label text-primary underline">
              {d.mimeType === "application/pdf" ? "فایل PDF سند" : "تصویر سند"}
              {docs.length > 1 ? ` ${fa.format(i + 1)}` : ""}
            </a>
          ))}
        </div>
      )}

      {row.history.length > 1 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-label text-ink/70">تاریخچه تغییرات</summary>
          <ol className="mt-2 flex flex-col gap-2 border-r-2 border-ink/10 pr-3 text-label">
            {row.history.map((h) => (
              <li key={h.entryId + h.type}>
                <span className="text-ink/60">{jalaliDateTimeLabel(h.at)} — </span>
                {h.type === "created" && <>ثبت اولیه{h.amountRial !== null && <>: <span className="num">{rialToTomanLabel(h.amountRial)}</span></>}</>}
                {h.type === "edited" && <>اصلاح به: <span className="num">{rialToTomanLabel(h.amountRial ?? 0n)}</span></>}
                {h.type === "document" && <>سند اضافه شد</>}
                {h.type === "voided" && <>حذف شد</>}
                <span className="text-ink/60"> — {ctx.people.get(h.by) ?? "مدیر"}</span>
                {h.reason && <div className="text-ink/80">دلیل: {h.reason}</div>}
              </li>
            ))}
          </ol>
        </details>
      )}

      {actions && <div className="mt-2 flex gap-3 text-label">{actions}</div>}
    </article>
  );
}
