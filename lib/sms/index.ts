// SMS goes through this interface only; nothing else knows the provider.

export interface SmsSender {
  send(to: string, text: string): Promise<{ ok: boolean; providerId?: string }>;
}

/** Development: prints the message instead of sending it. */
export class ConsoleSmsSender implements SmsSender {
  async send(to: string, text: string) {
    console.log(`[sms → ${to}] ${text}`);
    return { ok: true };
  }
}

/** Templates. Keep each within two Persian SMS parts (134 characters). */
export const smsText = {
  otp: (code: string) => `کد ورود شما: ${code}`,
};

let sender: SmsSender | undefined;

export function getSmsSender(): SmsSender {
  if (sender) return sender;
  const kind = process.env.SMS_SENDER ?? "console";
  if (kind === "console") return (sender = new ConsoleSmsSender());
  throw new Error(`SMS_SENDER=${kind} is not implemented yet`);
}
