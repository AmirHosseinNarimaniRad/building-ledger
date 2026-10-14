// Kavenegar "verify/lookup": https://kavenegar.com/rest.html
// Values go in token, token2, token3 (no spaces, up to 100 characters each); the template's
// text uses %token, %token2, %token3. Success is return.status 200.
import { localMobile, logSmsFailure, postJson, type SmsMessage, type SmsResult, type SmsSender } from "./shared";

export interface KavenegarOptions {
  apiKey: string;
  /** Template names as created in the Kavenegar panel. */
  templates: Record<SmsMessage["kind"], string>;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The template's tokens, in the order deploy/SMS.md lists them. */
export function kavenegarTokens(m: SmsMessage): Record<string, string> {
  switch (m.kind) {
    case "otp":
      return { token: m.code };
    case "chargeIssued":
      return { token: m.month, token2: m.amount, token3: m.link };
    case "arrearsReminder":
      return { token: m.amount, token2: m.link };
  }
}

export class KavenegarSmsSender implements SmsSender {
  constructor(private readonly opts: KavenegarOptions) {}

  async send(to: string, message: SmsMessage): Promise<SmsResult> {
    const tokens = kavenegarTokens(message);
    const bad = Object.entries(tokens).find(([, v]) => !v || /\s/.test(v));
    if (bad) return this.fail(message, `token ${bad[0]} is empty or has a space`);

    const { baseUrl = "https://api.kavenegar.com", fetch: fetchFn = fetch, timeoutMs = 8000 } = this.opts;
    const res = await postJson(
      fetchFn,
      `${baseUrl}/v1/${encodeURIComponent(this.opts.apiKey)}/verify/lookup.json`,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ receptor: localMobile(to), template: this.opts.templates[message.kind], ...tokens }).toString(),
      },
      timeoutMs,
    );
    if ("error" in res) return this.fail(message, res.error);

    const body = res.body as { return?: { status?: number; message?: string }; entries?: { messageid?: number }[] } | null;
    const status = body?.return?.status ?? res.status;
    if (status !== 200) return this.fail(message, `${status} ${body?.return?.message ?? ""}`.trim());
    const id = body?.entries?.[0]?.messageid;
    return { ok: true, providerId: id === undefined ? undefined : String(id) };
  }

  private fail(message: SmsMessage, error: string): SmsResult {
    logSmsFailure("kavenegar", message.kind, error);
    return { ok: false, error };
  }
}
