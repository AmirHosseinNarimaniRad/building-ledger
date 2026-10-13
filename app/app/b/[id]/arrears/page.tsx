import Link from "next/link";
import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import { listArrears } from "@/lib/arrears";
import { rialToTomanLabel } from "@/lib/money";
import { displayMobile } from "@/lib/phone";
import { jalaliDateTimeLabel } from "@/lib/date";
import { Alert, Card, PageTitle } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { remindAction } from "./actions";

const fa = new Intl.NumberFormat("fa-IR");

export default async function ArrearsPage({ params, searchParams }: PageProps<"/app/b/[id]/arrears">) {
  const { id } = await params;
  const { sent, skipped } = await searchParams;
  await requireBuilding(id);
  const rows = await listArrears(db(), id);
  const total = rows.reduce((a, r) => a + r.debtRial, 0n);
  const remindable = rows.filter((r) => r.remindable).length;

  return (
    <>
      <PageTitle
        action={
          remindable > 0 ? (
            <form action={remindAction.bind(null, id, undefined)}>
              <SubmitButton pendingText="در حال ارسال…">یادآور به همه ({fa.format(remindable)})</SubmitButton>
            </form>
          ) : undefined
        }
      >
        معوقات
      </PageTitle>

      {typeof sent === "string" && (
        <div className="mb-3">
          <Alert tone="good">
            برای {fa.format(Number(sent))} واحد یادآور فرستاده شد
            {Number(skipped) > 0 && ` · ${fa.format(Number(skipped))} واحد بدون موبایل یا با یادآور در ۲۴ ساعت گذشته`}
          </Alert>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>هیچ واحدی بدهکار نیست.</Card>
      ) : (
        <>
          <Card className="mb-3">
            <div className="text-label text-ink/70">جمع معوقات {fa.format(rows.length)} واحد</div>
            <div className="num text-title font-bold text-danger">{rialToTomanLabel(total)}</div>
          </Card>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <Card key={r.unitId} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">واحد {r.label}</div>
                    <div className="text-small text-ink/60">
                      {[r.residentName, r.phone && displayMobile(r.phone)].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="num font-bold text-danger">{rialToTomanLabel(r.debtRial)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-label">
                  <Link href={`/app/b/${id}/payments/new?unit=${r.unitId}`} className="text-primary underline">
                    ثبت پرداخت
                  </Link>
                  {r.remindable ? (
                    <form action={remindAction.bind(null, id, r.unitId)}>
                      <button type="submit" className="text-primary underline">
                        یادآور پیامکی
                      </button>
                    </form>
                  ) : (
                    <span className="text-ink/50">
                      {!r.phone
                        ? "موبایل ثبت نشده"
                        : `یادآور فرستاده شد ${r.lastReminderAt ? jalaliDateTimeLabel(r.lastReminderAt) : ""}`}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
