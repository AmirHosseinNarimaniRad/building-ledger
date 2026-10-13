"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { requireBuilding } from "@/lib/auth/session";
import { sendReminders } from "@/lib/arrears";
import { getSmsSender } from "@/lib/sms";

/** unitId omitted = remind every unit that owes. */
export async function remindAction(buildingId: string, unitId?: string) {
  const { user } = await requireBuilding(buildingId);
  if (unitId !== undefined && !isUuid(unitId)) return;
  const { sent, skipped } = await sendReminders(db(), getSmsSender(), {
    buildingId,
    unitIds: unitId ? [unitId] : null,
    by: user.id,
  });
  redirect(`/app/b/${buildingId}/arrears?sent=${sent}&skipped=${skipped}`);
}
