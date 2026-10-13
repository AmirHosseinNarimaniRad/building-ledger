"use client";

import { startTransition, useActionState } from "react";
import { Alert, Card } from "@/components/ui";
import { shrinkImage } from "@/components/shrink-image";
import { attachDocumentAction, type FormState } from "../../actions";

export function DocumentForm({ buildingId, entryId }: { buildingId: string; entryId: string }) {
  const [state, dispatch, pending] = useActionState(attachDocumentAction.bind(null, buildingId, entryId), {} as FormState);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", await shrinkImage(file));
    startTransition(() => dispatch(fd));
  }

  return (
    <Card className="flex flex-col gap-3">
      {state.error && <Alert>{state.error}</Alert>}
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink/20 p-6 text-center hover:border-primary">
        <span className="font-semibold">{pending ? "در حال بارگذاری…" : "عکس یا PDF سند را انتخاب کنید"}</span>
        <span className="text-small text-ink/60">در دفتر به‌عنوان رویداد تازه ثبت می‌شود؛ خود هزینه ویرایش نمی‌شود.</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          className="sr-only"
          disabled={pending}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
    </Card>
  );
}
