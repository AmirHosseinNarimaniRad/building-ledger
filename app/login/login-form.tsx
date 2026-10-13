"use client";

import { useActionState } from "react";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { displayMobile } from "@/lib/phone";
import { loginStep, type LoginState } from "./actions";

const initial: LoginState = { step: "phone", phone: "" };

export function LoginForm() {
  const [state, action] = useActionState(loginStep, initial);

  if (state.step === "phone") {
    return (
      <form action={action} className="flex flex-col gap-4">
        {state.error && <Alert>{state.error}</Alert>}
        <input type="hidden" name="intent" value="send" />
        <Field label="شماره موبایل">
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            placeholder="0912 123 4567"
            defaultValue={state.phone}
            required
            autoFocus
          />
        </Field>
        <SubmitButton pendingText="در حال ارسال…">دریافت کد</SubmitButton>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Alert>{state.error}</Alert>}
      <p className="text-label text-ink/70">
        کد ۶ رقمی به <span dir="ltr">{displayMobile(state.phone)}</span> فرستاده شد.
      </p>
      <input type="hidden" name="intent" value="verify" />
      <input type="hidden" name="phone" value={state.phone} />
      <Field label="کد ورود">
        <Input
          name="code"
          inputMode="numeric"
          dir="ltr"
          autoComplete="one-time-code"
          maxLength={6}
          className="text-center tracking-[0.5em]"
          required
          autoFocus
        />
      </Field>
      <SubmitButton pendingText="در حال بررسی…">ورود</SubmitButton>
    </form>
  );
}
