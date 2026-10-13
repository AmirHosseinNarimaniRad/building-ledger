"use client";

import { useActionState, useEffect, useRef } from "react";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { UnitFormState } from "./actions";

export interface UnitDefaults {
  label?: string;
  area?: string;
  occupants?: string;
  residentName?: string;
  phone?: string;
  isActive?: boolean;
}

export function UnitForm({
  action,
  defaults = {},
  submitLabel,
  showActive = false,
}: {
  action: (prev: UnitFormState, form: FormData) => Promise<UnitFormState>;
  defaults?: UnitDefaults;
  submitLabel: string;
  showActive?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.errors ?? {};

  // After adding a unit, clear the form for the next one.
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.saved && <Alert tone="good">واحد ثبت شد</Alert>}
      <div className="grid grid-cols-3 gap-3">
        <Field label="واحد" error={e.label}>
          <Input name="label" defaultValue={defaults.label} invalid={!!e.label} required />
        </Field>
        <Field label="متراژ (متر)" error={e.area}>
          <Input name="area" inputMode="decimal" dir="ltr" defaultValue={defaults.area} invalid={!!e.area} />
        </Field>
        <Field label="نفرات" error={e.occupants}>
          <Input
            name="occupants"
            inputMode="numeric"
            dir="ltr"
            defaultValue={defaults.occupants ?? "1"}
            invalid={!!e.occupants}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="نام ساکن">
          <Input name="residentName" defaultValue={defaults.residentName} />
        </Field>
        <Field label="موبایل ساکن" error={e.phone} hint="لینک صورت‌حساب به این شماره پیامک می‌شود">
          <Input name="phone" type="tel" dir="ltr" defaultValue={defaults.phone} invalid={!!e.phone} />
        </Field>
      </div>
      {showActive && (
        <label className="flex items-center gap-2 text-label">
          <input type="checkbox" name="isActive" defaultChecked={defaults.isActive ?? true} />
          فعال (در تقسیم شارژ حساب می‌شود)
        </label>
      )}
      <SubmitButton className="self-start">{submitLabel}</SubmitButton>
    </form>
  );
}
