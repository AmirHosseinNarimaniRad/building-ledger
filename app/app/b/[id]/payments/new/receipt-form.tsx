"use client";

import { useActionState, useState } from "react";
import { Alert, Card, Field, Input, inputStyles } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createReceiptAction, type FormState } from "../../ledger/actions";

export interface UnitOption {
  id: string;
  label: string;
  residentName: string | null;
  debtLabel: string | null;
}

export function ReceiptForm({
  buildingId,
  units,
  today,
  preselectUnit,
}: {
  buildingId: string;
  units: UnitOption[];
  today: string;
  preselectUnit?: string;
}) {
  const [state, action] = useActionState(createReceiptAction.bind(null, buildingId), {} as FormState);
  const v = state.fields ?? {};
  const [kind, setKind] = useState(v.kind || "payment");

  return (
    <Card>
      <form action={action} className="flex flex-col gap-3">
        {state.error && <Alert>{state.error}</Alert>}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral p-1">
          {[
            ["payment", "پرداخت شارژ واحد"],
            ["income", "درآمد دیگر"],
          ].map(([k, label]) => (
            <label
              key={k}
              className={`cursor-pointer rounded-lg py-2 text-center font-medium ${kind === k ? "bg-background shadow-sm" : "text-ink/60"}`}
            >
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>

        {kind === "payment" ? (
          <Field label="واحد">
            <select name="unitId" defaultValue={v.unitId || preselectUnit || ""} className={inputStyles} required>
              <option value="" disabled>
                انتخاب واحد
              </option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                  {u.residentName ? ` — ${u.residentName}` : ""}
                  {u.debtLabel ? ` (بدهی ${u.debtLabel})` : ""}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="بابت">
            <Input name="title" defaultValue={v.title} placeholder="مثلاً اجاره پشت‌بام" required />
          </Field>
        )}

        <Field label="مبلغ (تومان)">
          <Input name="amount" inputMode="numeric" dir="ltr" defaultValue={v.amount} required />
        </Field>
        <Field label="تاریخ">
          <Input name="date" dir="ltr" inputMode="numeric" defaultValue={v.date || today} />
        </Field>
        <Field label="توضیح" hint="اختیاری، مثلاً شماره پیگیری کارت‌به‌کارت">
          <Input name="note" defaultValue={v.note} />
        </Field>
        <SubmitButton>ثبت دریافتی</SubmitButton>
      </form>
    </Card>
  );
}
