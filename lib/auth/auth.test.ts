import { randomInt } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { appDb, ownerDb } from "@/test/support";
import { normalizeMobile } from "@/lib/phone";
import type { SmsSender } from "@/lib/sms";
import { createSession, OTP_MAX_ATTEMPTS, requestOtp, revokeSession, sessionUser, verifyOtp } from "./otp";

const sql = appDb();
afterAll(async () => {
  await sql.end();
  await ownerDb().end();
});

/** Captures sent messages so tests can read the code. */
function fakeSms() {
  const sent: { to: string; text: string }[] = [];
  const sms: SmsSender = { send: async (to, text) => (sent.push({ to, text }), { ok: true }) };
  const lastCode = () => /(\d{6})/.exec(sent.at(-1)!.text)![1];
  return { sms, sent, lastCode };
}

const newPhone = () => `+98935${String(randomInt(10_000_000)).padStart(7, "0")}`;
const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;

/** Pretend the last code for this phone was sent long ago, to step past the resend timer. */
async function ageCodes(phone: string, minutes: number) {
  await ownerDb()`UPDATE otp_codes SET created_at = created_at - ${`${minutes} minutes`}::interval WHERE phone = ${phone}`;
}

describe("phone numbers", () => {
  it("accepts the usual ways Iranians write a mobile number", () => {
    for (const s of ["09121234567", "9121234567", "+989121234567", "00989121234567", "۰۹۱۲ ۱۲۳ ۴۵۶۷", "0912-123-4567"]) {
      expect(normalizeMobile(s)).toBe("+989121234567");
    }
    expect(normalizeMobile("02112345678")).toBeNull(); // landline
    expect(normalizeMobile("0912123456")).toBeNull(); // too short
  });
});

describe("OTP login", () => {
  it("sends a 6-digit code, logs in once with it, and creates the manager", async () => {
    const phone = newPhone();
    const { sms, sent, lastCode } = fakeSms();
    await requestOtp(sql, { phone, ip: newIp(), sms });
    expect(sent[0].to).toBe(phone);
    const code = lastCode();

    const userId = await verifyOtp(sql, { phone, code });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    // Single use.
    await expect(verifyOtp(sql, { phone, code })).rejects.toMatchObject({ code: "expired" });
  });

  it("refuses a second code within 60 seconds", async () => {
    const phone = newPhone();
    const { sms } = fakeSms();
    await requestOtp(sql, { phone, ip: newIp(), sms });
    await expect(requestOtp(sql, { phone, ip: newIp(), sms })).rejects.toMatchObject({ code: "too_soon" });
  });

  it("allows at most 5 codes an hour per phone, and per IP", async () => {
    const phone = newPhone();
    const { sms } = fakeSms();
    for (let i = 0; i < 5; i++) {
      await requestOtp(sql, { phone, ip: newIp(), sms });
      await ageCodes(phone, 2);
    }
    await expect(requestOtp(sql, { phone, ip: newIp(), sms })).rejects.toMatchObject({ code: "too_many" });

    const ip = newIp();
    for (let i = 0; i < 5; i++) await requestOtp(sql, { phone: newPhone(), ip, sms });
    await expect(requestOtp(sql, { phone: newPhone(), ip, sms })).rejects.toMatchObject({ code: "too_many" });
  });

  it(`locks the code after ${OTP_MAX_ATTEMPTS} wrong tries, even if the right one comes next`, async () => {
    const phone = newPhone();
    const { sms, lastCode } = fakeSms();
    await requestOtp(sql, { phone, ip: newIp(), sms });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(verifyOtp(sql, { phone, code: wrong })).rejects.toBeTruthy();
    }
    await expect(verifyOtp(sql, { phone, code })).rejects.toMatchObject({ code: "too_many_attempts" });
  });

  it("rejects an expired code", async () => {
    const phone = newPhone();
    const { sms, lastCode } = fakeSms();
    await requestOtp(sql, { phone, ip: newIp(), sms });
    await ownerDb()`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone = ${phone}`;
    await expect(verifyOtp(sql, { phone, code: lastCode() })).rejects.toMatchObject({ code: "expired" });
  });

  it("sessions resolve to the user until revoked", async () => {
    const phone = newPhone();
    const { sms, lastCode } = fakeSms();
    await requestOtp(sql, { phone, ip: newIp(), sms });
    const userId = await verifyOtp(sql, { phone, code: lastCode() });
    const { token } = await createSession(sql, userId);
    expect((await sessionUser(sql, token))?.id).toBe(userId);
    await revokeSession(sql, token);
    expect(await sessionUser(sql, token)).toBeNull();
    expect(await sessionUser(sql, "not-a-real-token")).toBeNull();
  });
});
