// SMS.ir "send/verify" (API v1): POST https://api.sms.ir/v1/send/verify with an X-API-KEY header.
// Values go in named parameters; the template's text uses #CODE#, #MONTH#, #AMOUNT#, #LINK#.
// Success is HTTP 200 with status 1.
import { localMobile, logSmsFailure, postJson, type SmsMessage, type SmsResult, type SmsSender } from "./shared";

export interface SmsIrOptions {
  apiKey: string;
  /** Template ids as shown in the SMS.ir panel. */
  templates: Record<SmsMessage["kind"], number>;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function smsIrParameters(m: SmsMessage): { name: string; value: string }[] {
  switch (m.kind) {
    case "otp":
      return [{ name: "CODE", value: m.code }];
    case "chargeIssued":
      return [
        { name: "MONTH", value: m.month },
        { name: "AMOUNT", value: m.amount },
        { name: "LINK", value: m.link },
      ];
    case "arrearsReminder":
      return [
        { name: "AMOUNT", value: m.amount },
        { name: "LINK", value: m.link },
      ];
  }
}

export class SmsIrSender implements SmsSender {
  constructor(private readonly opts: SmsIrOptions) {
    for (const [kind, id] of Object.entries(opts.templates)) {
      if (!Number.isInteger(id) || id <= 0) throw new Error(`SMS.ir template id for ${kind} must be a number`);
    }
  }

  async send(to: string, message: SmsMessage): Promise<SmsResult> {
    const { baseUrl = "https://api.sms.ir", fetch: fetchFn = fetch, timeoutMs = 8000 } = this.opts;
    const res = await postJson(
      fetchFn,
      `${baseUrl}/v1/send/verify`,
      {
        headers: { "X-API-KEY": this.opts.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          mobile: localMobile(to),
          templateId: this.opts.templates[message.kind],
          parameters: smsIrParameters(message),
        }),
      },
      timeoutMs,
    );
    if ("error" in res) return this.fail(message, res.error);

    const body = res.body as { status?: number; message?: string; data?: { messageId?: number } } | null;
    if (res.status !== 200 || body?.status !== 1) {
      return this.fail(message, `${res.status}/${body?.status ?? "?"} ${body?.message ?? ""}`.trim());
    }
    const id = body.data?.messageId;
    return { ok: true, providerId: id === undefined ? undefined : String(id) };
  }

  private fail(message: SmsMessage, error: string): SmsResult {
    logSmsFailure("smsir", message.kind, error);
    return { ok: false, error };
  }
}
