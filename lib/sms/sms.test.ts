// The SMS providers against a local stand-in for each panel: what goes over the wire, and how
// failures come back. No real SMS is sent.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSmsSender, renderSms, SMS_MAX_CHARS, type SmsMessage } from ".";
import { KavenegarSmsSender } from "./kavenegar";
import { SmsIrSender } from "./smsir";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server;
let baseUrl: string;
let seen: Seen[] = [];
/** What the fake panel answers next: [http status, JSON body], or "hang" to time out. */
let reply: [number, unknown] | "hang" = [200, {}];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (reply === "hang") return; // never answers
      res.writeHead(reply[0], { "Content-Type": "application/json" }).end(JSON.stringify(reply[1]));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
afterEach(() => {
  seen = [];
  vi.restoreAllMocks();
});

const PHONE = "+989121234567";
const KEY = "secret-api-key-123";
const LINK = "https://daftar-shafaf.ir/r/AbCdEfGhIjKlMnOpQrStUv";
const charge: SmsMessage = { kind: "chargeIssued", month: "اردیبهشت", amount: "۹۹٬۹۹۹٬۹۹۰", link: LINK };

/** A failed send logs the provider's answer, never the number, the key or the message. */
function expectQuietLog(spy: ReturnType<typeof vi.spyOn>) {
  const logged = spy.mock.calls.flat().join(" ");
  expect(logged).toMatch(/^\[sms\]/);
  for (const secret of [KEY, "09121234567", "1234567", LINK, "AbCdEf"]) expect(logged).not.toContain(secret);
}

describe("message texts", () => {
  it("fit two Persian SMS parts even at the longest month, a large amount and a full link", () => {
    for (const m of [{ kind: "otp", code: "123456" }, charge, { kind: "arrearsReminder", amount: "۹۹۹٬۹۹۹٬۹۹۰", link: LINK }] as SmsMessage[]) {
      expect(renderSms(m).length).toBeLessThanOrEqual(SMS_MAX_CHARS);
    }
  });
});

describe("Kavenegar", () => {
  const sender = (timeoutMs = 2000) =>
    new KavenegarSmsSender({
      apiKey: KEY,
      templates: { otp: "ledger-otp", chargeIssued: "ledger-charge", arrearsReminder: "ledger-reminder" },
      baseUrl,
      timeoutMs,
    });

  it("sends a lookup with the template's tokens to a local number", async () => {
    reply = [200, { return: { status: 200, message: "تایید شد" }, entries: [{ messageid: 8792343 }] }];
    expect(await sender().send(PHONE, charge)).toEqual({ ok: true, providerId: "8792343" });

    const [req] = seen;
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`/v1/${KEY}/verify/lookup.json`);
    expect(Object.fromEntries(new URLSearchParams(req.body))).toEqual({
      receptor: "09121234567",
      template: "ledger-charge",
      token: "اردیبهشت",
      token2: "۹۹٬۹۹۹٬۹۹۰",
      token3: LINK,
    });
  });

  it("reports the panel's refusal, e.g. out of credit", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    reply = [418, { return: { status: 418, message: "اعتبار شما کافی نمی‌باشد" }, entries: null }];
    const res = await sender().send(PHONE, { kind: "otp", code: "123456" });
    expect(res).toEqual({ ok: false, error: "418 اعتبار شما کافی نمی‌باشد" });
    expectQuietLog(log);
  });

  it("gives up on a panel that does not answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    reply = "hang";
    expect(await sender(200).send(PHONE, { kind: "otp", code: "123456" })).toEqual({ ok: false, error: "timeout" });
  });

  it("refuses a token with a space before calling the panel", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sender().send(PHONE, { ...charge, month: "اردیبهشت ۱۴۰۵" } as SmsMessage);
    expect(res.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });
});

describe("SMS.ir", () => {
  const sender = () =>
    new SmsIrSender({ apiKey: KEY, templates: { otp: 100001, chargeIssued: 100002, arrearsReminder: 100003 }, baseUrl });

  it("sends a verify request with named parameters and the key in a header", async () => {
    reply = [200, { status: 1, message: "موفق", data: { messageId: 55, cost: 1.5 } }];
    expect(await sender().send(PHONE, charge)).toEqual({ ok: true, providerId: "55" });

    const [req] = seen;
    expect(req.url).toBe("/v1/send/verify");
    expect(req.headers["x-api-key"]).toBe(KEY);
    expect(JSON.parse(req.body)).toEqual({
      mobile: "09121234567",
      templateId: 100002,
      parameters: [
        { name: "MONTH", value: "اردیبهشت" },
        { name: "AMOUNT", value: "۹۹٬۹۹۹٬۹۹۰" },
        { name: "LINK", value: LINK },
      ],
    });
  });

  it("reports a refusal, whether by HTTP status or by the body's status", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    reply = [401, { status: 0, message: "کلید نامعتبر" }];
    expect((await sender().send(PHONE, { kind: "otp", code: "123456" })).ok).toBe(false);
    reply = [200, { status: 0, message: "خطا" }];
    expect((await sender().send(PHONE, { kind: "otp", code: "123456" })).ok).toBe(false);
    expectQuietLog(log);
  });

  it("rejects a template id that is not a number", () => {
    expect(() => new SmsIrSender({ apiKey: KEY, templates: { otp: NaN, chargeIssued: 1, arrearsReminder: 2 } })).toThrow(/otp/);
  });
});

describe("choosing the sender", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("fails at start-up when a setting is missing", () => {
    process.env.SMS_SENDER = "kavenegar";
    process.env.KAVENEGAR_API_KEY = KEY;
    delete process.env.KAVENEGAR_TEMPLATE_OTP;
    expect(() => createSmsSender()).toThrow(/KAVENEGAR_TEMPLATE_OTP/);
    process.env.SMS_SENDER = "carrier-pigeon";
    expect(() => createSmsSender()).toThrow(/not supported/);
  });

  it("builds each provider from its settings", () => {
    Object.assign(process.env, {
      SMS_SENDER: "smsir",
      SMSIR_API_KEY: KEY,
      SMSIR_TEMPLATE_OTP: "1",
      SMSIR_TEMPLATE_CHARGE: "2",
      SMSIR_TEMPLATE_REMINDER: "3",
    });
    expect(createSmsSender()).toBeInstanceOf(SmsIrSender);
  });
});
