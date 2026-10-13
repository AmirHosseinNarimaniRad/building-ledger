"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { normalizeMobile } from "@/lib/phone";
import { normalizeDigits } from "@/lib/money";
import { getSmsSender } from "@/lib/sms";
import { OtpError, requestOtp, verifyOtp } from "@/lib/auth/otp";
import { startSession } from "@/lib/auth/session";
import { clientIpFrom } from "@/lib/client-ip";

export interface LoginState {
  step: "phone" | "code";
  phone: string;
  error?: string;
}

async function clientIp() {
  return clientIpFrom(await headers());
}

async function requestCode(form: FormData): Promise<LoginState> {
  const typed = String(form.get("phone") ?? "");
  const phone = normalizeMobile(typed);
  if (!phone) return { step: "phone", phone: typed, error: "شماره موبایل درست نیست؛ مثل ۰۹۱۲۱۲۳۴۵۶۷" };
  try {
    await requestOtp(db(), { phone, ip: await clientIp(), sms: getSmsSender() });
  } catch (err) {
    if (err instanceof OtpError) {
      // A recent code is still valid: let them type it instead of blocking them.
      if (err.code === "too_soon") return { step: "code", phone, error: err.message };
      return { step: "phone", phone: typed, error: err.message };
    }
    throw err;
  }
  return { step: "code", phone };
}

async function verifyCode(form: FormData): Promise<LoginState> {
  const phone = String(form.get("phone") ?? "");
  const code = normalizeDigits(String(form.get("code") ?? "")).replace(/\D/g, "");
  if (!normalizeMobile(phone)) return { step: "phone", phone: "", error: "شماره موبایل را دوباره وارد کنید" };
  if (code.length !== 6) return { step: "code", phone, error: "کد ۶ رقمی است" };

  try {
    const userId = await verifyOtp(db(), { phone, code });
    await startSession(userId);
  } catch (err) {
    if (err instanceof OtpError) {
      const restart = err.code === "expired" || err.code === "too_many_attempts";
      return { step: restart ? "phone" : "code", phone, error: err.message };
    }
    throw err;
  }
  redirect("/app");
}

/** One action for both steps, so the form has a single state to follow. */
export async function loginStep(_prev: LoginState, form: FormData): Promise<LoginState> {
  return form.get("intent") === "verify" ? verifyCode(form) : requestCode(form);
}
