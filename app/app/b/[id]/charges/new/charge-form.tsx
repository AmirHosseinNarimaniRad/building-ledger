"use client";

import { useActionState, useState, useTransition } from "react";
import { Alert, Button, Card, Field, Input, inputStyles } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { issueChargeAction, previewChargeAction, type IssueState, type PreviewResult } from "../actions";

const MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const MODES = [
  ["mixed", "ثابت + نفرات", "بخشی مساوی، بقیه به نسبت نفرات (رایج‌ترین)"],
  ["equal", "مساوی", "همه واحدها یک مبلغ"],
  ["by_occupants", "به نسبت نفرات", ""],
  ["by_area", "به نسبت متراژ", ""],
] as const;
const faPlain = new Intl.NumberFormat("fa-IR", { useGrouping: false });

export function ChargeForm({
  buildingId,
  current,
  reissue,
}: {
  buildingId: string;
  current: { jy: number; jm: number };
  reissue?: { periodId: string; jy: number; jm: number };
}) {
  const [state, action] = useActionState(issueChargeAction.bind(null, buildingId), {} as IssueState);
  const [total, setTotal] = useState("");
  const [mode, setMode] = useState<string>("mixed");
  const [fixedPercent, setFixedPercent] = useState("40");
  const [preview, setPreview] = useState<PreviewResult>();
  const [previewing, startPreview] = useTransition();

  // Any change makes the old preview stale; confirming needs a fresh one.
  const changed = (fn: () => void) => () => {
    fn();
    setPreview(undefined);
  };

  function runPreview() {
    startPreview(async () => setPreview(await previewChargeAction(buildingId, { total, mode, fixedPercent })));
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Alert>{state.error}</Alert>}
      <Card className="flex flex-col gap-3">
        {reissue ? (
          <>
            <input type="hidden" name="reissueOf" value={reissue.periodId} />
            <p className="font-semibold">
              صدور دوباره شارژ {MONTHS[reissue.jm - 1]} {faPlain.format(reissue.jy)}
            </p>
            <p className="text-small text-ink/60">
              همه رکوردهای شارژ قبلی این ماه با دلیل زیر باطل و نمایش داده می‌شوند و شارژ تازه صادر می‌شود.
            </p>
            <Field label="دلیل">
              <Input name="reason" required minLength={3} placeholder="مثلاً مبلغ کل اشتباه وارد شده بود" />
            </Field>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="ماه">
              <select name="jm" defaultValue={current.jm} className={inputStyles}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="سال">
              <select name="jy" defaultValue={current.jy} className={inputStyles}>
                {[current.jy - 1, current.jy, current.jy + 1].map((y) => (
                  <option key={y} value={y}>
                    {faPlain.format(y)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <Field label="مبلغ کل شارژ ماه (تومان)">
          <Input
            name="total"
            inputMode="numeric"
            dir="ltr"
            value={total}
            onChange={(e) => changed(() => setTotal(e.target.value))()}
            required
          />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-label font-semibold">روش تقسیم</legend>
          {MODES.map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2">
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={changed(() => setMode(value))}
                className="mt-1.5"
              />
              <span>
                {label}
                {hint && <span className="block text-small text-ink/60">{hint}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        {mode === "mixed" && (
          <Field label="سهم ثابت (درصد)" hint="مثلاً ۴۰ یعنی ۴۰٪ مساوی بین واحدها و ۶۰٪ به نسبت نفرات">
            <Input
              name="fixedPercent"
              inputMode="decimal"
              dir="ltr"
              value={fixedPercent}
              onChange={(e) => changed(() => setFixedPercent(e.target.value))()}
            />
          </Field>
        )}
        <Button type="button" variant="secondary" onClick={runPreview} disabled={previewing || !total}>
          {previewing ? "در حال محاسبه…" : "پیش‌نمایش سهم هر واحد"}
        </Button>
      </Card>

      {preview?.error && <Alert>{preview.error}</Alert>}
      {preview?.rows && (
        <Card className="p-0">
          <table className="w-full text-label">
            <thead className="bg-neutral">
              <tr>
                <th className="p-2 text-right">واحد</th>
                <th className="p-2 text-right">سهم</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.label} className="border-t border-ink/10">
                  <td className="p-2">{r.label}</td>
                  <td className="num p-2">{r.share}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ink/20 font-bold">
                <td className="p-2">جمع</td>
                <td className="num p-2">{preview.total}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      <SubmitButton disabled={!preview?.rows} pendingText="در حال صدور و ارسال…">
        تأیید، صدور و ارسال پیامک
      </SubmitButton>
      {!preview?.rows && <p className="-mt-2 text-small text-ink/60">اول پیش‌نمایش را ببینید.</p>}
    </form>
  );
}
