// SMS goes through this interface only; nothing else knows the provider.
//
// Every message is a template approved in the provider's panel ("verify"/"lookup" sends): they go
// out on the provider's service lines, reach numbers that block advertising SMS, and need no
// dedicated line. The app sends only the template's values; the panel holds the text.
// deploy/SMS.md has the texts to submit for approval.
import { renderSms, type SmsMessage, type SmsResult, type SmsSender } from "./shared";
import { KavenegarSmsSender } from "./kavenegar";
import { SmsIrSender } from "./smsir";

export * from "./shared";

/** Development: prints the message instead of sending it. */
export class ConsoleSmsSender implements SmsSender {
  async send(to: string, message: SmsMessage): Promise<SmsResult> {
    console.log(`[sms → ${to}] ${renderSms(message)}`);
    return { ok: true };
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when SMS_SENDER=${process.env.SMS_SENDER}`);
  return value;
}

/** Builds the sender SMS_SENDER names; throws on a missing setting (see instrumentation.ts). */
export function createSmsSender(): SmsSender {
  const kind = process.env.SMS_SENDER ?? "console";
  switch (kind) {
    case "console":
      return new ConsoleSmsSender();
    case "kavenegar":
      return new KavenegarSmsSender({
        apiKey: required("KAVENEGAR_API_KEY"),
        templates: {
          otp: required("KAVENEGAR_TEMPLATE_OTP"),
          chargeIssued: required("KAVENEGAR_TEMPLATE_CHARGE"),
          arrearsReminder: required("KAVENEGAR_TEMPLATE_REMINDER"),
        },
      });
    case "smsir":
      return new SmsIrSender({
        apiKey: required("SMSIR_API_KEY"),
        templates: {
          otp: Number(required("SMSIR_TEMPLATE_OTP")),
          chargeIssued: Number(required("SMSIR_TEMPLATE_CHARGE")),
          arrearsReminder: Number(required("SMSIR_TEMPLATE_REMINDER")),
        },
      });
    default:
      throw new Error(`SMS_SENDER=${kind} is not supported (console | kavenegar | smsir)`);
  }
}

let sender: SmsSender | undefined;

export function getSmsSender(): SmsSender {
  return (sender ??= createSmsSender());
}
