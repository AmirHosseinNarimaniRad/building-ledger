"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireBuilding } from "@/lib/auth/session";
import {
  addUnits,
  DuplicateLabelError,
  parseUnit,
  updateUnit,
  type FieldErrors,
  type RawUnit,
} from "@/lib/units";

export interface UnitFormState {
  errors?: FieldErrors;
  error?: string;
  saved?: boolean;
}

function rawFrom(form: FormData): RawUnit {
  return {
    label: String(form.get("label") ?? ""),
    area: String(form.get("area") ?? ""),
    occupants: String(form.get("occupants") ?? ""),
    residentName: String(form.get("residentName") ?? ""),
    phone: String(form.get("phone") ?? ""),
    isActive: form.has("isActive") ? form.get("isActive") === "on" : true,
  };
}

export async function addUnitAction(buildingId: string, _prev: UnitFormState, form: FormData): Promise<UnitFormState> {
  await requireBuilding(buildingId);
  const { value, errors } = parseUnit(rawFrom(form));
  if (Object.keys(errors).length) return { errors };
  try {
    await addUnits(db(), buildingId, [value]);
  } catch (err) {
    if (err instanceof DuplicateLabelError) return { errors: { label: err.message } };
    throw err;
  }
  revalidatePath(`/app/b/${buildingId}/units`);
  return { saved: true };
}

export async function updateUnitAction(
  buildingId: string,
  unitId: string,
  _prev: UnitFormState,
  form: FormData,
): Promise<UnitFormState> {
  await requireBuilding(buildingId);
  const raw = { ...rawFrom(form), isActive: form.get("isActive") === "on" };
  const { value, errors } = parseUnit(raw);
  if (Object.keys(errors).length) return { errors };
  try {
    await updateUnit(db(), buildingId, unitId, value);
  } catch (err) {
    if (err instanceof DuplicateLabelError) return { errors: { label: err.message } };
    throw err;
  }
  redirect(`/app/b/${buildingId}/units`);
}

export interface BulkResult {
  rowErrors?: Record<number, FieldErrors>;
  error?: string;
}

/** Called from the bulk grid with plain rows. All rows are saved, or none. */
export async function addUnitsBulkAction(buildingId: string, rows: RawUnit[]): Promise<BulkResult> {
  await requireBuilding(buildingId);
  // Blank grid rows are skipped; errors keep the grid's own row numbers.
  const filled = rows
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => Object.values(r).some((v) => typeof v === "string" && v.trim()));
  if (filled.length === 0) return { error: "هیچ واحدی وارد نشده" };
  if (filled.length > 500) return { error: "حداکثر ۵۰۰ واحد در هر بار" };

  const rowErrors: Record<number, FieldErrors> = {};
  const values = filled.map(({ r, index }) => {
    const { value, errors } = parseUnit(r);
    if (Object.keys(errors).length) rowErrors[index] = errors;
    return value;
  });
  if (Object.keys(rowErrors).length) return { rowErrors };

  try {
    await addUnits(db(), buildingId, values);
  } catch (err) {
    if (err instanceof DuplicateLabelError) return { error: err.message };
    throw err;
  }
  redirect(`/app/b/${buildingId}/units`);
}
