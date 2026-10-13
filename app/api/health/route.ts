import { db } from "@/lib/db";

// For Docker/nginx health checks: the app is up and can reach the database.
export async function GET() {
  try {
    await db()`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
