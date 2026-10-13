import { afterAll, describe, expect, it } from "vitest";
import { appDb, makeBuilding, ownerDb } from "@/test/support";
import { fromJalali } from "./date";
import { createEntry, editEntry, lockEntries, voidEntry } from "./ledger";
import { issueCharge } from "./charge";
import { monthlyReport } from "./report";
import { listArrears, sendReminders } from "./arrears";
import type { SmsSender } from "./sms";

const sql = appDb();
afterAll(async () => {
  await sql.end();
  await ownerDb().end();
});
const toman = (n: number) => BigInt(n) * 10n;

describe("monthly report", () => {
  it("reconciles: closing = opening + collected + other income − expenses, through edits and voids", async () => {
    const b = await makeBuilding(sql, 2);
    const base = { buildingId: b.buildingId, createdBy: b.userId };
    // Shahrivar: opening material.
    await createEntry(sql, { ...base, kind: "income", amountRial: toman(5_000_000), occurredOn: fromJalali(1405, 6, 10), title: "اجاره" });
    // Mehr.
    await issueCharge(sql, { buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(2_000_000), formula: { mode: "equal" }, by: b.userId });
    await createEntry(sql, { ...base, kind: "payment", amountRial: toman(1_000_000), occurredOn: fromJalali(1405, 7, 3), title: "پرداخت", unitId: b.unitIds[0] });
    const lift = await createEntry(sql, { ...base, kind: "expense", amountRial: toman(800_000), occurredOn: fromJalali(1405, 7, 5), title: "آسانسور", docState: "pending_doc" });
    const dup = await createEntry(sql, { ...base, kind: "expense", amountRial: toman(300_000), occurredOn: fromJalali(1405, 7, 6), title: "تکراری", docState: "pending_doc" });
    const moved = await createEntry(sql, { ...base, kind: "expense", amountRial: toman(100_000), occurredOn: fromJalali(1405, 7, 7), title: "جابه‌جا", docState: "pending_doc" });
    await lockEntries(sql, [lift.id, dup.id, moved.id]);
    await editEntry(sql, { id: lift.id, changes: { amountRial: toman(850_000) }, reason: "فاکتور نهایی", by: b.userId });
    await voidEntry(sql, { id: dup.id, reason: "تکراری بود", by: b.userId });
    // Corrected into Aban: must leave Mehr entirely.
    await editEntry(sql, { id: moved.id, changes: { occurredOn: fromJalali(1405, 8, 2) }, reason: "تاریخ اشتباه", by: b.userId });

    const r = await monthlyReport(sql, b.buildingId, 1405, 7);
    expect(r.openingRial).toBe(toman(5_000_000));
    expect(r.collectedRial).toBe(toman(1_000_000));
    expect(r.otherIncomeRial).toBe(0n);
    expect(r.expensesRial).toBe(toman(850_000));
    expect(r.chargedRial).toBe(toman(2_000_000));
    expect(r.closingRial).toBe(r.openingRial + r.collectedRial + r.otherIncomeRial - r.expensesRial);
    expect(r.arrearsRial).toBe(toman(1_000_000));
    // The list matches the totals: live rows add up to the expense total.
    const live = r.expenseRows.filter((x) => !x.voided).reduce((a, x) => a + (x.entry.amountRial ?? 0n), 0n);
    expect(live).toBe(r.expensesRial);
    expect(r.expenseRows.map((x) => x.entry.title).sort()).toEqual(["آسانسور", "تکراری"]);

    const aban = await monthlyReport(sql, b.buildingId, 1405, 8);
    expect(aban.expensesRial).toBe(toman(100_000));
    expect(aban.openingRial).toBe(r.closingRial);
  });
});

describe("arrears reminders", () => {
  it("texts units that owe, once a day at most, and skips units without a phone", async () => {
    const b = await makeBuilding(sql, 3);
    await sql`UPDATE units SET phone = '+989121111111' WHERE id = ${b.unitIds[0]}`;
    await sql`UPDATE units SET phone = '+989122222222' WHERE id = ${b.unitIds[1]}`;
    await issueCharge(sql, { buildingId: b.buildingId, jy: 1405, jm: 7, totalRial: toman(3_000_000), formula: { mode: "equal" }, by: b.userId });
    await createEntry(sql, { buildingId: b.buildingId, kind: "payment", amountRial: toman(1_000_000), occurredOn: fromJalali(1405, 7, 3), title: "پرداخت", unitId: b.unitIds[1], createdBy: b.userId });

    const rows = await listArrears(sql, b.buildingId);
    expect(rows.map((r) => r.unitId).sort()).toEqual([b.unitIds[0], b.unitIds[2]].sort()); // unit 2 paid in full

    const sent: string[] = [];
    const sms: SmsSender = { send: async (_to, text) => (sent.push(text), { ok: true }) };
    expect(await sendReminders(sql, sms, { buildingId: b.buildingId, unitIds: null, by: b.userId })).toEqual({ sent: 1, skipped: 1 });
    expect(sent[0]).toMatch(/^بدهی شما: ۱٬۰۰۰٬۰۰۰ تومان — http\S+\/r\/[A-Za-z0-9_-]{22}$/);

    // Again right away: nothing goes out.
    expect(await sendReminders(sql, sms, { buildingId: b.buildingId, unitIds: null, by: b.userId })).toEqual({ sent: 0, skipped: 2 });
    await ownerDb()`UPDATE arrears_reminders SET sent_at = sent_at - interval '25 hours' WHERE unit_id = ${b.unitIds[0]}`;
    expect((await sendReminders(sql, sms, { buildingId: b.buildingId, unitIds: [b.unitIds[0]], by: b.userId })).sent).toBe(1);
  });
});
