"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createBuilding } from "@/lib/buildings";
import { endSession, requireUser } from "@/lib/auth/session";

export async function logout() {
  await endSession();
  redirect("/login");
}

export interface BuildingFormState {
  error?: string;
  name?: string;
  address?: string;
}

export async function createBuildingAction(_prev: BuildingFormState, form: FormData): Promise<BuildingFormState> {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").trim();
  const address = String(form.get("address") ?? "").trim();
  if (!name) return { error: "نام ساختمان لازم است", name, address };
  if (name.length > 80) return { error: "نام ساختمان حداکثر ۸۰ حرف است", name, address };

  const id = await createBuilding(db(), { userId: user.id, name, address: address || null });
  redirect(`/app/b/${id}/units/bulk`);
}
