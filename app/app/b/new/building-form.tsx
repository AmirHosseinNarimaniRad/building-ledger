"use client";

import { useActionState } from "react";
import { Alert, Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { createBuildingAction, type BuildingFormState } from "../../actions";

export function BuildingForm() {
  const [state, action] = useActionState(createBuildingAction, {} as BuildingFormState);
  return (
    <Card>
      <form action={action} className="flex flex-col gap-4">
        {state.error && <Alert>{state.error}</Alert>}
        <Field label="نام ساختمان">
          <Input name="name" defaultValue={state.name} placeholder="مثلاً ساختمان یاس" required autoFocus />
        </Field>
        <Field label="نشانی" hint="اختیاری">
          <Input name="address" defaultValue={state.address} />
        </Field>
        <SubmitButton>ساخت و رفتن به ورود واحدها</SubmitButton>
      </form>
    </Card>
  );
}
