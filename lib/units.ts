import { withTx, type Db } from "./db";
import { normalizeDigits } from "./money";
import { normalizeMobile } from "./phone";

export interface Unit {
  id: string;
  label: string;
  sortKey: number;
  areaM2: string | null;
  occupants: number;
  residentName: string | null;
  phone: string | null;
  isActive: boolean;
  debtRial: bigint;
}

export interface UnitInput {
  label: string;
  areaM2: string | null;
  occupants: number;
  residentName: string | null;
  phone: string | null;
  isActive: boolean;
}

export interface RawUnit {
  label?: string;
  area?: string;
  occupants?: string;
  residentName?: string;
  phone?: string;
  isActive?: boolean;
}

export type UnitField = "label" | "area" | "occupants" | "phone";
export type FieldErrors = Partial<Record<UnitField, string>>;

/** Validates one unit as typed in a form or the bulk grid. Accepts Persian digits throughout. */
export function parseUnit(raw: RawUnit): { value: UnitInput; errors: FieldErrors } {
  const errors: FieldErrors = {};

  const label = normalizeSpaces(raw.label ?? "");
  if (!label) errors.label = "شماره یا نام واحد لازم است";
  else if (label.length > 40) errors.label = "حداکثر ۴۰ حرف";

  let areaM2: string | null = null;
  const area = normalizeDigits(raw.area ?? "").trim().replace(/[٫/,]/g, ".");
  if (area) {
    if (/^\d{1,6}(\.\d{1,2})?$/.test(area) && Number(area) > 0) areaM2 = area;
    else errors.area = "متراژ را مثل ۸۵ یا ۸۵٫۵ وارد کنید";
  }

  let occupants = 1;
  const occ = normalizeDigits(raw.occupants ?? "").trim();
  if (occ) {
    if (/^\d{1,2}$/.test(occ)) occupants = Number(occ);
    else errors.occupants = "تعداد نفرات عددی بین ۰ تا ۹۹ است";
  }

  let phone: string | null = null;
  if (raw.phone?.trim()) {
    phone = normalizeMobile(raw.phone);
    if (!phone) errors.phone = "شماره موبایل درست نیست";
  }

  const residentName = normalizeSpaces(raw.residentName ?? "") || null;
  return { value: { label, areaM2, occupants, residentName, phone, isActive: raw.isActive ?? true }, errors };
}

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

export class DuplicateLabelError extends Error {
  constructor(readonly label: string) {
    super(`واحد «${label}» قبلاً ثبت شده است`);
  }
}

function isLabelClash(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505" &&
    (err as { constraint_name?: string }).constraint_name === "units_building_id_label_key"
  );
}

export async function listUnits(sql: Db, buildingId: string): Promise<Unit[]> {
  return sql<Unit[]>`
    SELECT u.id, u.label, u.sort_key, u.area_m2, u.occupants, u.resident_name, u.phone, u.is_active,
           COALESCE(d.debt_rial, 0)::bigint AS debt_rial
    FROM units u LEFT JOIN unit_debts d ON d.unit_id = u.id
    WHERE u.building_id = ${buildingId}
    ORDER BY u.sort_key`;
}

export async function getUnit(sql: Db, buildingId: string, unitId: string): Promise<Unit | null> {
  const units = await listUnits(sql, buildingId);
  return units.find((u) => u.id === unitId) ?? null;
}

/** Adds units after the existing ones, in the given order. All or nothing. */
export async function addUnits(sql: Db, buildingId: string, inputs: UnitInput[]): Promise<number> {
  const seen = new Set<string>();
  for (const u of inputs) {
    if (seen.has(u.label)) throw new DuplicateLabelError(u.label);
    seen.add(u.label);
  }
  try {
    return await withTx(sql, async (tx) => {
      const [{ max }] = await tx<{ max: number }[]>`
        SELECT COALESCE(MAX(sort_key), 0)::int AS max FROM units WHERE building_id = ${buildingId}`;
      for (const [i, u] of inputs.entries()) {
        await tx`
          INSERT INTO units (building_id, label, sort_key, area_m2, occupants, resident_name, phone, is_active)
          VALUES (${buildingId}, ${u.label}, ${max + i + 1}, ${u.areaM2}, ${u.occupants},
                  ${u.residentName}, ${u.phone}, ${u.isActive})`;
      }
      return inputs.length;
    });
  } catch (err) {
    if (isLabelClash(err)) {
      const label = /\(building_id, label\)=\([^,]+, (.+)\)/.exec((err as { detail?: string }).detail ?? "")?.[1];
      throw new DuplicateLabelError(label ?? "");
    }
    throw err;
  }
}

/** Units are editable (the ledger is not). A new phone number revokes the old resident link. */
export async function updateUnit(sql: Db, buildingId: string, unitId: string, input: UnitInput) {
  try {
    await withTx(sql, async (tx) => {
      const [cur] = await tx<{ phone: string | null }[]>`
        SELECT phone FROM units WHERE id = ${unitId} AND building_id = ${buildingId} FOR UPDATE`;
      if (!cur) throw new Error("unit not found");
      await tx`
        UPDATE units SET label = ${input.label}, area_m2 = ${input.areaM2}, occupants = ${input.occupants},
          resident_name = ${input.residentName}, phone = ${input.phone}, is_active = ${input.isActive}
        WHERE id = ${unitId}`;
      if (cur.phone !== input.phone) {
        await tx`UPDATE resident_tokens SET revoked_at = now() WHERE unit_id = ${unitId} AND revoked_at IS NULL`;
      }
    });
  } catch (err) {
    if (isLabelClash(err)) throw new DuplicateLabelError(input.label);
    throw err;
  }
}
