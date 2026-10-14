// Types and helpers shared by the SMS senders.

export type SmsMessage =
  | { kind: "otp"; code: string }
  /** amount: toman digits without the unit, e.g. '۱٬۲۵۰٬۰۰۰'. */
  | { kind: "chargeIssued"; month: string; amount: string; link: string }
  | { kind: "arrearsReminder"; amount: string; link: string };

export type SmsResult = { ok: true; providerId?: string } | { ok: false; error: string };

export interface SmsSender {
  /** to: E.164 (+98…). Never throws: a failure comes back as { ok: false }. */
  send(to: string, message: SmsMessage): Promise<SmsResult>;
}

/**
 * The text a recipient sees. Must match the templates in deploy/SMS.md word for word: the
 * console sender prints it in development, and the tests keep it within two Persian SMS parts.
 */
export function renderSms(m: SmsMessage): string {
  switch (m.kind) {
    case "otp":
      return `کد ورود شما: ${m.code}\nدفتر شفاف ساختمان`;
    case "chargeIssued":
      return `شارژ ${m.month} ساختمان شما: ${m.amount} تومان\nجزئیات: ${m.link}`;
    case "arrearsReminder":
      return `یادآوری بدهی شارژ ساختمان: ${m.amount} تومان\nجزئیات: ${m.link}`;
  }
}

/** A batch stops after this many failures in a row: the panel is down or out of credit. */
export const SMS_MAX_FAILURES_IN_A_ROW = 3;

/** Two Persian (UCS-2) SMS parts. */
export const SMS_MAX_CHARS = 134;

/** +989121234567 → 09121234567, the form both Iranian panels expect. */
export function localMobile(e164: string): string {
  return e164.startsWith("+98") ? `0${e164.slice(3)}` : e164;
}

/** Shared by the providers: a POST with a timeout, returning parsed JSON or an error string. */
export async function postJson(
  fetchFn: typeof fetch,
  url: string,
  init: { headers: Record<string, string>; body: string },
  timeoutMs: number,
): Promise<{ status: number; body: unknown } | { error: string }> {
  try {
    const res = await fetchFn(url, { method: "POST", ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (err) {
    return { error: err instanceof Error && err.name === "TimeoutError" ? "timeout" : `network: ${String(err)}` };
  }
}

/** Logs a failed send without the recipient's number, the text or the API key. */
export function logSmsFailure(provider: string, kind: SmsMessage["kind"], error: string) {
  console.error(`[sms] ${provider} failed to send ${kind}: ${error}`);
}
