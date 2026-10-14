// Sends one SMS of each template to a phone, with sample values, using the configured panel.
// Run it once the templates are approved, before letting managers in:
//   dev:        npm run sms:test -- 09121234567
//   production: docker compose -f docker-compose.prod.yml --env-file .env exec app node sms-test.cjs 09121234567
import { randomBytes } from "node:crypto";
import { normalizeMobile } from "../lib/phone";
import { createSmsSender, renderSms, SMS_MAX_CHARS, type SmsMessage } from "../lib/sms";
import { jalaliMonthName, todayTehran, toJalali } from "../lib/date";

async function main() {
  const phone = normalizeMobile(process.argv[2] ?? "");
  if (!phone) throw new Error("usage: sms-test <mobile number>, e.g. 09121234567");

  const sender = createSmsSender();
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // A link of the real length that opens the "invalid link" page.
  const link = `${base}/r/${randomBytes(16).toString("base64url")}`;
  const month = jalaliMonthName(toJalali(todayTehran()).jm);
  const messages: SmsMessage[] = [
    { kind: "otp", code: "123456" },
    { kind: "chargeIssued", month, amount: "۱٬۲۵۰٬۰۰۰", link },
    { kind: "arrearsReminder", amount: "۲٬۵۰۰٬۰۰۰", link },
  ];

  console.log(`SMS_SENDER=${process.env.SMS_SENDER ?? "console"}, to ${phone}`);
  let failures = 0;
  for (const m of messages) {
    const text = renderSms(m);
    const res = await sender.send(phone, m);
    console.log(`${res.ok ? "sent  " : "FAILED"} ${m.kind} (${text.length}/${SMS_MAX_CHARS} chars)${res.ok ? (res.providerId ? `, id ${res.providerId}` : "") : `: ${res.error}`}`);
    if (!res.ok) failures++;
  }
  if (failures) process.exit(1);
  console.log("Check the phone: each text should match deploy/SMS.md word for word.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
