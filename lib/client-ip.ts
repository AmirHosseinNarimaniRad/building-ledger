/**
 * The client's IP for rate limits. The first X-Forwarded-For entry is whatever the client sent,
 * so it is never trusted: use X-Real-IP (the reverse proxy must overwrite it), else the last
 * X-Forwarded-For hop, which our own proxy appended.
 */
export function clientIpFrom(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return hops?.at(-1) ?? null;
}
