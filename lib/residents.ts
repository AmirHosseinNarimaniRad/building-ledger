// Resident links: the passwordless link is the product's core and its biggest attack surface.
// 16 random bytes (128 bits) in the URL; sha256 for lookup; AES-GCM copy so the same link can be
// sent every month. One active token per unit.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { withTx, type Db } from "./db";

export const TOKEN_DAYS = 180;
/** A token this close to expiry is replaced when the next SMS goes out. */
export const ROTATE_WITHIN_DAYS = 14;

function key(): Buffer {
  const k = Buffer.from(process.env.RESIDENT_TOKEN_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("RESIDENT_TOKEN_KEY must be 32 bytes, base64");
  return k;
}

export function hashToken(raw: string): Buffer {
  return createHash("sha256").update(raw).digest();
}

function encrypt(raw: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function decrypt(blob: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8");
}

export function residentUrl(raw: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/r/${raw}`;
}

export async function revokeTokens(sql: Db, unitId: string) {
  await sql`UPDATE resident_tokens SET revoked_at = now() WHERE unit_id = ${unitId} AND revoked_at IS NULL`;
}

async function createToken(sql: Db, unitId: string): Promise<string> {
  const raw = randomBytes(16).toString("base64url");
  await sql`
    INSERT INTO resident_tokens (unit_id, token_hash, token_enc, expires_at)
    VALUES (${unitId}, ${hashToken(raw)}, ${encrypt(raw)}, now() + ${`${TOKEN_DAYS} days`}::interval)`;
  return raw;
}

/** The unit's current link token: the same one every time, unless it is about to expire. */
export async function currentToken(sql: Db, unitId: string): Promise<string> {
  return withTx(sql, async (tx) => {
    const [active] = await tx<{ tokenEnc: Buffer; fresh: boolean }[]>`
      SELECT token_enc, expires_at > now() + ${`${ROTATE_WITHIN_DAYS} days`}::interval AS fresh
      FROM resident_tokens
      WHERE unit_id = ${unitId} AND revoked_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1
      FOR UPDATE`;
    if (active?.fresh) return decrypt(active.tokenEnc);
    await revokeTokens(tx, unitId);
    return createToken(tx, unitId);
  });
}

/** Manager asked for a new link (old one lost or leaked). */
export async function rotateToken(sql: Db, unitId: string): Promise<string> {
  return withTx(sql, async (tx) => {
    await revokeTokens(tx, unitId);
    return createToken(tx, unitId);
  });
}

/** Who a link belongs to, or null. Expired, revoked and unknown all look the same. */
export async function resolveToken(sql: Db, raw: string) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(raw)) return null;
  const [row] = await sql<{ tokenId: string; unitId: string; buildingId: string }[]>`
    UPDATE resident_tokens t SET last_seen_at = now()
    FROM units u
    WHERE t.token_hash = ${hashToken(raw)} AND t.revoked_at IS NULL AND t.expires_at > now()
      AND u.id = t.unit_id
    RETURNING t.id AS token_id, t.unit_id, u.building_id`;
  return row ?? null;
}
