import { afterAll, describe, expect, it } from "vitest";
import { appDb, makeBuilding, ownerDb } from "@/test/support";
import { buildingForManager } from "./buildings";
import { addUnits, DuplicateLabelError, listUnits, parseUnit, updateUnit } from "./units";

const sql = appDb();
afterAll(async () => {
  await sql.end();
  await ownerDb().end();
});

describe("unit input", () => {
  it("reads Persian digits and decimal separators, defaults occupants to 1", () => {
    const { value, errors } = parseUnit({ label: " ۱۰۱ ", area: "۸۵٫۵", occupants: "", phone: "۰۹۱۲۱۲۳۴۵۶۷" });
    expect(errors).toEqual({});
    expect(value).toMatchObject({ label: "۱۰۱", areaM2: "85.5", occupants: 1, phone: "+989121234567" });
  });

  it("explains each bad field", () => {
    const { errors } = parseUnit({ label: "", area: "abc", occupants: "-1", phone: "123" });
    expect(Object.keys(errors).sort()).toEqual(["area", "label", "occupants", "phone"]);
  });
});

describe("units", () => {
  it("adds units in order after the existing ones", async () => {
    const b = await makeBuilding(sql, 2);
    const parsed = ["۱۰۱", "۱۰۲", "۲۰۱"].map((label) => parseUnit({ label }).value);
    await addUnits(sql, b.buildingId, parsed);
    const units = await listUnits(sql, b.buildingId);
    expect(units.map((u) => u.label)).toEqual(["1", "2", "۱۰۱", "۱۰۲", "۲۰۱"]);
    expect(new Set(units.map((u) => u.sortKey)).size).toBe(5);
  });

  it("rejects duplicate labels, in the batch or against existing units, and saves nothing", async () => {
    const b = await makeBuilding(sql, 1);
    const dup = ["۵", "۵"].map((label) => parseUnit({ label }).value);
    await expect(addUnits(sql, b.buildingId, dup)).rejects.toBeInstanceOf(DuplicateLabelError);

    const clash = ["۶", "1"].map((label) => parseUnit({ label }).value);
    await expect(addUnits(sql, b.buildingId, clash)).rejects.toMatchObject({ label: "1" });
    expect(await listUnits(sql, b.buildingId)).toHaveLength(1);
  });

  it("a new phone number revokes the unit's resident link", async () => {
    const b = await makeBuilding(sql, 1);
    const unitId = b.unitIds[0];
    await ownerDb()`
      INSERT INTO resident_tokens (unit_id, token_hash, expires_at)
      VALUES (${unitId}, ${Buffer.from("x".repeat(32))}, now() + interval '180 days')`;

    const base = parseUnit({ label: "1", phone: "09121111111" }).value;
    await updateUnit(sql, b.buildingId, unitId, base); // null → number: a change
    await ownerDb()`UPDATE resident_tokens SET revoked_at = NULL WHERE unit_id = ${unitId}`;

    await updateUnit(sql, b.buildingId, unitId, { ...base, occupants: 3 }); // same phone
    let [t] = await ownerDb()<{ revokedAt: Date | null }[]>`SELECT revoked_at FROM resident_tokens WHERE unit_id = ${unitId}`;
    expect(t.revokedAt).toBeNull();

    await updateUnit(sql, b.buildingId, unitId, { ...base, phone: "+989122222222" });
    [t] = await ownerDb()<{ revokedAt: Date | null }[]>`SELECT revoked_at FROM resident_tokens WHERE unit_id = ${unitId}`;
    expect(t.revokedAt).not.toBeNull();
  });

  it("a manager cannot reach another manager's building", async () => {
    const mine = await makeBuilding(sql, 1);
    const theirs = await makeBuilding(sql, 1);
    expect(await buildingForManager(sql, mine.buildingId, mine.userId)).not.toBeNull();
    expect(await buildingForManager(sql, theirs.buildingId, mine.userId)).toBeNull();
    expect(await buildingForManager(sql, "not-a-uuid", mine.userId)).toBeNull();
  });
});
