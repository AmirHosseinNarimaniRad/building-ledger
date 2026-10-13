import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { buildingForManager } from "@/lib/buildings";
import { createSession, revokeSession, sessionUser } from "./otp";

export const SESSION_COOKIE = "bl_session";

export async function startSession(userId: string) {
  const { token, expiresAt } = await createSession(db(), userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(db(), token);
  store.delete(SESSION_COOKIE);
}

/** The logged-in manager, or null. Cached per request. */
export const currentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sessionUser(db(), token) : null;
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The one ownership check: every page and action under /app/b/[id] calls this.
 * A building that isn't yours looks exactly like one that doesn't exist.
 */
export const requireBuilding = cache(async (buildingId: string) => {
  const user = await requireUser();
  const building = await buildingForManager(db(), buildingId, user.id);
  if (!building) notFound();
  return { user, building };
});
