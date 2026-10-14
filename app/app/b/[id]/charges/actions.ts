"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import { ChargeError, issueCharge, previewCharge, reissueCharge, type Formula } from "@/lib/charge";
import { MoneyInputError, normalizeDigits, rialToTomanLabel, tomanInputToRial } from "@/lib/money";
import { sendChargeNotices } from "@/lib/notify";
import { getSmsSender } from "@/lib/sms";
import { isUuid } from "@/lib/buildings";

export interface ChargeInput {
  total: string;
  mode: string;
  fixedPercent: string;
}

export interface PreviewResult {
  error?: string;
  rows?: { label: string; share: string }[];
  total?: string;
}

function parseFormula(mode: string, fixedPercent: string): Formula | string {
  if (mode === "equal" || mode === "by_area" || mode === "by_occupants") return { mode };
  if (mode !== "mixed") return "روش تقسیم را انتخاب کنید";
  const p = normalizeDigits(fixedPercent).trim().replace(/[٫/]/g, ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(p) || Number(p) > 100) return "سهم ثابت را درصدی بین ۰ تا ۱۰۰ وارد کنید";
  return { mode: "mixed", fixedShareBp: Math.round(Number(p) * 100) };
}

function parse(input: ChargeInput): { totalRial: bigint; formula: Formula } | string {
  let totalRial: bigint;
  try {
    totalRial = tomanInputToRial(input.total);
  } catch (err) {
    if (err instanceof MoneyInputError) return err.message;
    throw err;
  }
  const formula = parseFormula(input.mode, input.fixedPercent);
  return typeof formula === "string" ? formula : { totalRial, formula };
}

export async function previewChargeAction(buildingId: string, input: ChargeInput): Promise<PreviewResult> {
  await requireBuilding(buildingId);
  const parsed = parse(input);
  if (typeof parsed === "string") return { error: parsed };
  try {
    const rows = await previewCharge(db(), { buildingId, ...parsed });
    return {
      rows: rows.map((r) => ({ label: r.label, share: rialToTomanLabel(r.shareRial) })),
      total: rialToTomanLabel(rows.reduce((a, r) => a + r.shareRial, 0n)),
    };
  } catch (err) {
    if (err instanceof ChargeError) return { error: err.message };
    throw err;
  }
}

export interface IssueState {
  error?: string;
}

export async function issueChargeAction(buildingId: string, _prev: IssueState, form: FormData): Promise<IssueState> {
  const { user } = await requireBuilding(buildingId);
  const get = (k: string) => String(form.get(k) ?? "");
  const parsed = parse({ total: get("total"), mode: get("mode"), fixedPercent: get("fixedPercent") });
  if (typeof parsed === "string") return { error: parsed };

  const reissueOf = get("reissueOf");
  let periodId: string;
  try {
    if (reissueOf) {
      const reason = get("reason").trim();
      if (reason.length < 3) return { error: "دلیل صدور دوباره را بنویسید؛ ساکنان آن را می‌بینند" };
      const [p] = isUuid(reissueOf)
        ? await db()`SELECT 1 FROM charge_periods WHERE id = ${reissueOf} AND building_id = ${buildingId}`
        : [];
      if (!p) return { error: "این دوره شارژ پیدا نشد" };
      ({ periodId } = await reissueCharge(db(), { periodId: reissueOf, reason, ...parsed, by: user.id }));
    } else {
      const jy = Number(get("jy"));
      const jm = Number(get("jm"));
      if (!(jy >= 1400 && jy <= 1500 && jm >= 1 && jm <= 12)) return { error: "ماه را انتخاب کنید" };
      ({ periodId } = await issueCharge(db(), { buildingId, jy, jm, ...parsed, by: user.id }));
    }
  } catch (err) {
    if (err instanceof ChargeError) return { error: err.message };
    throw err;
  }

  const { sent, failed } = await sendChargeNotices(db(), getSmsSender(), periodId);
  redirect(`/app/b/${buildingId}/charges?sent=${sent}&failed=${failed}`);
}
