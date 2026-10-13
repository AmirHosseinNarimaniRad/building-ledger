import { afterAll, describe, expect, it } from "vitest";
import { appDb, makeBuilding, ownerDb } from "@/test/support";
import { currentToken, hashToken, resolveToken, rotateToken, residentUrl } from "./residents";
import { loadResidentView } from "./resident-view";
import { sendChargeNotices } from "./notify";
import { issueCharge } from "./charge";
import { createEntry } from "./ledger";
import { fromJalali } from "./date";
import type { SmsSender } from "./sms";

const sql = appDb();
afterAll(async () => {
  await sql.end();
  await ownerDb().end();
});

const toman = (n: number) => BigInt(n) * 10n;

function fakeSms() {
  const sent: { to: string; text: string }[] = [];
  const sms: SmsSender = { send: async (to, text) => (sent.push({ to, text }), { ok: true }) };
  return { sms, sent };
}

describe("resident links", () => {
  it("are 22 characters, stored only as hash + ciphertext, and stay the same", async () => {
    const b = await makeBuilding(sql, 1);
    const unitId = b.unitIds[0];
    const raw = await currentToken(sql, unitId);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await currentToken(sql, unitId)).toBe(raw);

    const [row] = await ownerDb()<{ tokenHash: Buffer; tokenEnc: Buffer }[]>`
      SELECT token_hash, token_enc FROM resident_tokens WHERE unit_id = ${unitId}`;
    expect(row.tokenHash.equals(hashToken(raw))).toBe(true);
    expect(row.tokenEnc.toString("latin1")).not.toContain(raw);

    expect(await resolveToken(sql, raw)).toMatchObject({ unitId, buildingId: b.buildingId });
  });

  it("expired, revoked and unknown links all resolve to the same nothing", async () => {
    const b = await makeBuilding(sql, 1);
    const unitId = b.unitIds[0];
    const old = await currentToken(sql, unitId);
    const fresh = await rotateToken(sql, unitId);
    expect(fresh).not.toBe(old);
    expect(await resolveToken(sql, old)).toBeNull(); // revoked
    expect(await resolveToken(sql, "A".repeat(22))).toBeNull(); // unknown
    expect(await resolveToken(sql, "../../etc/passwd")).toBeNull(); // malformed

    await ownerDb()`UPDATE resident_tokens SET expires_at = now() - interval '1 second' WHERE unit_id = ${unitId}`;
    expect(await resolveToken(sql, fresh)).toBeNull(); // expired
  });

  it("a link close to expiry is replaced when the next SMS goes out", async () => {
    const b = await makeBuilding(sql, 1);
    const unitId = b.unitIds[0];
    const first = await currentToken(sql, unitId);
    await ownerDb()`UPDATE resident_tokens SET expires_at = now() + interval '10 days' WHERE unit_id = ${unitId}`;
    const second = await currentToken(sql, unitId);
    expect(second).not.toBe(first);
    expect(await resolveToken(sql, first)).toBeNull();
  });
});

describe("charge SMS", () => {
  it("texts each unit with a phone its share and the same link every month, within 2 SMS parts", async () => {
    process.env.APP_URL = "https://daftar-shafaf.ir";
    const b = await makeBuilding(sql, 3);
    await sql`UPDATE units SET phone = '+989121111111' WHERE id = ${b.unitIds[0]}`;
    await sql`UPDATE units SET phone = '+989122222222' WHERE id = ${b.unitIds[1]}`;
    const issue = (jm: number) =>
      issueCharge(sql, { buildingId: b.buildingId, jy: 1405, jm, totalRial: toman(12_345_000), formula: { mode: "equal" }, by: b.userId });

    const { sms, sent } = fakeSms();
    expect(await sendChargeNotices(sql, sms, (await issue(6)).periodId)).toBe(2);
    expect(await sendChargeNotices(sql, sms, (await issue(7)).periodId)).toBe(2);

    expect(sent[0].text).toMatch(/^شارژ شهریور: ۴٬۱۱۵٬۰۰۰ تومان — جزئیات: https:\/\/daftar-shafaf\.ir\/r\/[A-Za-z0-9_-]{22}$/);
    expect(sent[2].text.split(" ").at(-1)).toBe(sent[0].text.split(" ").at(-1)); // same link next month
    for (const s of sent) expect(s.text.length).toBeLessThanOrEqual(134);
    expect(sent.find((s) => s.text.includes(residentUrl("x").slice(0, -1)) && s.to === "+989121111111")).toBeTruthy();
  });
});

describe("the resident page shows only what it may", () => {
  it("has this unit's bill and the building's spending, and nothing personal about neighbours", async () => {
    const b = await makeBuilding(sql, 3);
    const [me, neighbour, other] = b.unitIds;
    await sql`UPDATE units SET label = 'MY-UNIT', resident_name = 'Me Myself', phone = '+989121111111', occupants = 2 WHERE id = ${me}`;
    await sql`UPDATE units SET label = 'NEIGHBOUR-UNIT', resident_name = 'Neighbour Name', phone = '+989129999999', occupants = 5, area_m2 = 133.33 WHERE id = ${neighbour}`;
    await sql`UPDATE units SET label = 'OTHER-UNIT', resident_name = 'Other Name', occupants = 3 WHERE id = ${other}`;

    await issueCharge(sql, { buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(10_000_000), formula: { mode: "by_occupants" }, by: b.userId });
    // The neighbour pays part: their payment must not show up on my page.
    await createEntry(sql, { buildingId: b.buildingId, kind: "payment", amountRial: toman(1_234_560), occurredOn: fromJalali(1405, 7, 3), title: "پرداخت واحد NEIGHBOUR-UNIT", unitId: neighbour, createdBy: b.userId });
    await createEntry(sql, { buildingId: b.buildingId, kind: "expense", amountRial: toman(800_000), occurredOn: fromJalali(1405, 7, 4), title: "تعمیر آسانسور", docState: "pending_doc", createdBy: b.userId });

    const view = await loadResidentView(sql, { unitId: me, buildingId: b.buildingId, month: { jy: 1405, jm: 7 } });
    expect(view.unitLabel).toBe("MY-UNIT");
    expect(view.bill?.shareRial).toBe(toman(2_000_000)); // 2 of 10 occupants
    expect(view.bill?.totalOccupants).toBe(10);
    expect(view.debtRial).toBe(toman(2_000_000));
    expect(view.buildingRows.map((r) => r.entry.title)).toEqual(["تعمیر آسانسور"]);

    const everything = JSON.stringify(view, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v instanceof Map ? [...v.entries()] : v,
    );
    for (const secret of ["NEIGHBOUR-UNIT", "OTHER-UNIT", "Neighbour Name", "Other Name", "989129999999", "133.33", neighbour, other, "12345600", "50000000", "30000000"]) {
      expect(everything).not.toContain(secret);
    }
  });
});
