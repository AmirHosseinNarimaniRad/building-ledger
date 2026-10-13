// OTP login rules (spec, "manager login"): 5-minute single-use code, 5 wrong tries,
// one send per 60 s, at most 5 per hour per phone and per IP.
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { withTx, type Db } from "@/lib/db";
import { smsText, type SmsSender } from "@/lib/sms";

export const OTP_TTL_MINUTES = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_MAX_PER_HOUR = 5;
export const SESSION_DAYS = 30;

export type OtpErrorCode = "too_soon" | "too_many" | "expired" | "wrong_code" | "too_many_attempts";

const MESSAGES: Record<OtpErrorCode, string> = {
  too_soon: "کمی صبر کنید و دوباره درخواست کد بدهید",
  too_many: "تعداد درخواست‌ها زیاد بود؛ یک ساعت دیگر دوباره امتحان کنید",
  expired: "کد منقضی شده؛ کد تازه بگیرید",
  wrong_code: "کد درست نیست",
  too_many_attempts: "تلاش‌های ناموفق زیاد بود؛ کد تازه بگیرید",
};

export class OtpError extends Error {
  constructor(
    readonly code: OtpErrorCode,
    readonly retryAfterSeconds?: number,
  ) {
    super(MESSAGES[code]);
  }
}

function hashCode(id: string, code: string) {
  return createHash("sha256").update(`${id}:${code}`).digest();
}

export function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest();
}

/** Sends a fresh code, unless a rate limit applies. phone must already be E.164. */
export async function requestOtp(sql: Db, args: { phone: string; ip: string | null; sms: SmsSender }) {
  const [stats] = await sql<{ lastAgeSeconds: number | null; phoneCount: number; ipCount: number }[]>`
    SELECT
      (SELECT extract(epoch FROM now() - max(created_at))::int FROM otp_codes WHERE phone = ${args.phone}) AS last_age_seconds,
      (SELECT count(*)::int FROM otp_codes WHERE phone = ${args.phone} AND created_at > now() - interval '1 hour') AS phone_count,
      (SELECT count(*)::int FROM otp_codes WHERE ip = ${args.ip} AND created_at > now() - interval '1 hour') AS ip_count`;

  if (stats.lastAgeSeconds !== null && stats.lastAgeSeconds < OTP_RESEND_SECONDS) {
    throw new OtpError("too_soon", OTP_RESEND_SECONDS - stats.lastAgeSeconds);
  }
  if (stats.phoneCount >= OTP_MAX_PER_HOUR || stats.ipCount >= OTP_MAX_PER_HOUR) {
    throw new OtpError("too_many");
  }

  const id = randomUUID();
  const code = String(randomInt(1_000_000)).padStart(6, "0");
  await sql`
    INSERT INTO otp_codes (id, phone, code_hash, ip, expires_at)
    VALUES (${id}, ${args.phone}, ${hashCode(id, code)}, ${args.ip},
            now() + ${`${OTP_TTL_MINUTES} minutes`}::interval)`;
  await args.sms.send(args.phone, smsText.otp(code));
}

/** Checks the code; on success returns the user id, creating the manager on first login. */
export async function verifyOtp(sql: Db, args: { phone: string; code: string }): Promise<string> {
  // The transaction returns a failure instead of throwing it: a throw would roll back the
  // attempts counter, and wrong guesses would never add up.
  const result = await withTx(sql, async (tx) => {
    const [otp] = await tx<{ id: string; codeHash: Buffer; attempts: number }[]>`
      SELECT id, code_hash, attempts FROM otp_codes
      WHERE phone = ${args.phone} AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE`;
    if (!otp) return { fail: "expired" as const };
    if (otp.attempts >= OTP_MAX_ATTEMPTS) return { fail: "too_many_attempts" as const };

    const given = hashCode(otp.id, args.code.trim());
    if (!timingSafeEqual(given, otp.codeHash)) {
      await tx`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${otp.id}`;
      return { fail: otp.attempts + 1 >= OTP_MAX_ATTEMPTS ? ("too_many_attempts" as const) : ("wrong_code" as const) };
    }

    await tx`UPDATE otp_codes SET consumed_at = now() WHERE id = ${otp.id}`;
    const [user] = await tx<{ id: string }[]>`
      INSERT INTO users (phone) VALUES (${args.phone})
      ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
      RETURNING id`;
    return { userId: user.id };
  });
  if (result.fail) throw new OtpError(result.fail);
  return result.userId!;
}

/** Creates a session and returns the raw token for the cookie. */
export async function createSession(sql: Db, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await sql<{ expiresAt: Date }[]>`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}, ${hashToken(token)}, now() + ${`${SESSION_DAYS} days`}::interval)
    RETURNING expires_at`;
  return { token, expiresAt: row.expiresAt };
}

export async function sessionUser(sql: Db, token: string) {
  const [user] = await sql<{ id: string; phone: string; displayName: string | null }[]>`
    SELECT u.id, u.phone, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)} AND s.revoked_at IS NULL AND s.expires_at > now()`;
  return user ?? null;
}

export async function revokeSession(sql: Db, token: string) {
  await sql`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hashToken(token)}`;
}
