"use client";

import { startTransition, useActionState, useState } from "react";
import { Alert, Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { shrinkImage } from "@/components/shrink-image";
import {
  createExpenseAction,
  uploadReceiptAction,
  type FormState,
  type UploadState,
} from "../../ledger/actions";

type Mode = "photo" | "manual";

export function ExpenseForm({ buildingId, today }: { buildingId: string; today: string }) {
  const [mode, setMode] = useState<Mode>("photo");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral p-1">
        {(["photo", "manual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg py-2 font-medium ${mode === m ? "bg-background shadow-sm" : "text-ink/60"}`}
          >
            {m === "photo" ? "از عکس فاکتور" : "دستی"}
          </button>
        ))}
      </div>
      {mode === "photo" ? <PhotoFlow buildingId={buildingId} /> : <ManualForm buildingId={buildingId} today={today} />}
    </div>
  );
}

function PhotoFlow({ buildingId }: { buildingId: string }) {
  const [upload, dispatchUpload, uploading] = useActionState(uploadReceiptAction.bind(null, buildingId), {} as UploadState);
  const [preview, setPreview] = useState<string>();

  async function onFile(file: File | undefined) {
    if (!file) return;
    const small = await shrinkImage(file);
    setPreview(small.type.startsWith("image/") ? URL.createObjectURL(small) : undefined);
    const fd = new FormData();
    fd.set("file", small);
    startTransition(() => dispatchUpload(fd));
  }

  return (
    <Card className="flex flex-col gap-4">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink/20 p-6 text-center hover:border-primary">
        <span className="font-semibold">{upload.storageKey ? "عکس دیگری انتخاب کنید" : "عکس فاکتور یا رسید را انتخاب کنید"}</span>
        <span className="text-small text-ink/60">JPG، PNG، WebP یا PDF — حداکثر ۱۰ مگابایت</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>

      {uploading && <p className="text-label text-ink/70">در حال خواندن فاکتور…</p>}
      {upload.error && <Alert>{upload.error}</Alert>}

      {upload.storageKey && upload.prefill && !uploading && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          {preview && <img src={preview} alt="پیش‌نمایش فاکتور" className="max-h-64 self-center rounded-xl border border-ink/10" />}
          {upload.lowConfidence ? (
            <Alert>نتوانستیم فاکتور را بخوانیم؛ لطفاً مبلغ و بابت را دستی وارد کنید.</Alert>
          ) : (
            <p className="text-label text-ink/70">این‌ها از روی فاکتور خوانده شد. بررسی و در صورت لزوم اصلاح کنید.</p>
          )}
          <ConfirmForm key={upload.storageKey} buildingId={buildingId} upload={upload} />
        </>
      )}
    </Card>
  );
}

function ConfirmForm({ buildingId, upload }: { buildingId: string; upload: UploadState }) {
  const [state, action] = useActionState(createExpenseAction.bind(null, buildingId), {} as FormState);
  const v = { ...upload.prefill, ...state.fields };
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="storageKey" value={upload.storageKey} />
      <AmountField defaultValue={v.amount} />
      <Field label="بابت">
        <Input name="title" defaultValue={v.title} required />
      </Field>
      <Field label="تاریخ">
        <Input name="date" dir="ltr" inputMode="numeric" defaultValue={v.date} />
      </Field>
      <Field label="توضیح" hint="اختیاری">
        <Input name="note" defaultValue={v.note} />
      </Field>
      <SubmitButton>ثبت هزینه با سند</SubmitButton>
    </form>
  );
}

/** Exactly three fields. The document label does the nudging, not a heavier form. */
function ManualForm({ buildingId, today }: { buildingId: string; today: string }) {
  const [state, action] = useActionState(createExpenseAction.bind(null, buildingId), {} as FormState);
  const v = state.fields ?? {};
  return (
    <Card>
      <form action={action} className="flex flex-col gap-3">
        {state.error && <Alert>{state.error}</Alert>}
        <input type="hidden" name="date" value={today} />
        <AmountField defaultValue={v.amount} />
        <Field label="بابت">
          <Input name="title" defaultValue={v.title} placeholder="مثلاً نظافت راه‌پله" required />
        </Field>
        <Field label="توضیح" hint="اختیاری">
          <Input name="note" defaultValue={v.note} />
        </Field>
        <label className="flex items-center gap-2 text-label">
          <input type="checkbox" name="noDocument" />
          سندی ندارد و نخواهد داشت (دلیلش را در توضیح بنویسید)
        </label>
        <p className="text-small text-ink/60">بدون سند ثبت می‌شود و برچسب «سند بعداً می‌آید» می‌گیرد؛ بعداً می‌توانید سند را اضافه کنید.</p>
        <SubmitButton>ثبت هزینه</SubmitButton>
      </form>
    </Card>
  );
}

export function AmountField({ defaultValue }: { defaultValue?: string }) {
  return (
    <Field label="مبلغ (تومان)">
      <Input name="amount" inputMode="numeric" dir="ltr" defaultValue={defaultValue} placeholder="۱٬۲۵۰٬۰۰۰" required autoFocus />
    </Field>
  );
}
