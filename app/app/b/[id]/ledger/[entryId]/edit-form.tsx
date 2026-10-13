"use client";

import { useActionState } from "react";
import { Alert, Card, Field, Input, inputStyles } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { editEntryAction, voidEntryAction, type FormState } from "../actions";

export interface EditDefaults {
  kind: "expense" | "income" | "payment";
  amount: string;
  title: string;
  date: string;
  note: string;
  docState: "documented" | "pending_doc" | "undocumented" | null;
}

export function EditForm({
  buildingId,
  entryId,
  locked,
  defaults,
}: {
  buildingId: string;
  entryId: string;
  locked: boolean;
  defaults: EditDefaults;
}) {
  const [state, action] = useActionState(editEntryAction.bind(null, buildingId, entryId), {} as FormState);
  const [voidState, voidAction] = useActionState(voidEntryAction.bind(null, buildingId, entryId), {} as FormState);
  const v = { ...defaults, ...state.fields };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form action={action} className="flex flex-col gap-3">
          {state.error && <Alert>{state.error}</Alert>}
          <Field label="مبلغ (تومان)">
            <Input name="amount" inputMode="numeric" dir="ltr" defaultValue={v.amount} required />
          </Field>
          <Field label="بابت">
            <Input name="title" defaultValue={v.title} required />
          </Field>
          <Field label="تاریخ">
            <Input name="date" dir="ltr" inputMode="numeric" defaultValue={v.date} />
          </Field>
          <Field label="توضیح">
            <Input name="note" defaultValue={v.note} />
          </Field>
          {defaults.kind === "expense" && defaults.docState !== "documented" && (
            <Field label="وضعیت سند">
              <select name="docState" defaultValue={v.docState ?? "pending_doc"} className={inputStyles}>
                <option value="pending_doc">سند بعداً می‌آید</option>
                <option value="undocumented">سندی ندارد (دلیل در توضیح)</option>
              </select>
            </Field>
          )}
          {locked && (
            <Field label="دلیل تغییر" hint="اجباری. این دلیل همراه مقدار قبلی به ساکنان هم نشان داده می‌شود.">
              <Input name="reason" defaultValue={state.fields?.reason} required minLength={3} />
            </Field>
          )}
          <SubmitButton>ذخیره</SubmitButton>
        </form>
      </Card>

      <Card>
        <form action={voidAction} className="flex flex-col gap-3">
          <h2 className="font-semibold">حذف این ردیف</h2>
          {voidState.error && <Alert>{voidState.error}</Alert>}
          {locked ? (
            <Field label="دلیل حذف" hint="ردیف در دفتر با نشان «حذف شده» و این دلیل باقی می‌ماند.">
              <Input name="reason" required minLength={3} />
            </Field>
          ) : (
            <p className="text-label text-ink/70">این ردیف هنوز پیش‌نویس است و بدون رد پاک می‌شود.</p>
          )}
          <SubmitButton variant="danger" className="self-start">
            حذف
          </SubmitButton>
        </form>
      </Card>
    </div>
  );
}
