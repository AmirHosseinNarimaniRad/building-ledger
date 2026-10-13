import { afterAll, describe, expect, it } from "vitest";
import { appDb, insertBackdated, makeBuilding, ownerDb } from "@/test/support";
import { fromJalali } from "@/lib/date";
import {
  attachDocument,
  buildingBalance,
  createEntry,
  editEntry,
  LedgerError,
  loadLedger,
  lockEntries,
  lockMonth,
  unitDebt,
  voidEntry,
  type Entry,
} from "@/lib/ledger";

const sql = appDb();
const MEHR_5 = fromJalali(1405, 7, 5);
const ABAN_5 = fromJalali(1405, 8, 5);
const file = { storageKey: "test/receipt.jpg", mimeType: "image/jpeg", byteSize: 1234 };

afterAll(async () => {
  await sql.end();
  await ownerDb().end();
});

async function expense(b: { buildingId: string; userId: string }, toman: number, extra: Partial<Entry> = {}) {
  return createEntry(sql, {
    buildingId: b.buildingId,
    kind: "expense",
    amountRial: BigInt(toman) * 10n,
    occurredOn: MEHR_5,
    title: "تعمیر آسانسور",
    docState: "pending_doc",
    createdBy: b.userId,
    ...(extra as object),
  });
}

async function issueChargeRow(b: { buildingId: string; userId: string }, unitId: string, toman: number) {
  const [period] = await sql<{ id: string }[]>`
    INSERT INTO charge_periods (building_id, jalali_year, jalali_month, total_rial, formula)
    VALUES (${b.buildingId}, 1405, 7, ${BigInt(toman) * 10n}, ${sql.json({ mode: "equal" })})
    RETURNING id`;
  return createEntry(sql, {
    buildingId: b.buildingId,
    kind: "charge_issued",
    amountRial: BigInt(toman) * 10n,
    occurredOn: MEHR_5,
    title: "شارژ مهر",
    unitId,
    periodId: period.id,
    createdBy: b.userId,
  });
}

describe("ledger rules (spec section 4)", () => {
  it("UPDATE on a locked entry fails", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 8_000_000);
    await lockEntries(sql, [e.id]);
    await expect(sql`UPDATE ledger_entries SET title = 'x' WHERE id = ${e.id}`).rejects.toThrow(/locked/);
    await expect(sql`DELETE FROM ledger_entries WHERE id = ${e.id}`).rejects.toThrow(/locked/);
  });

  it("an entry older than 30 minutes is locked even with empty locked_at", async () => {
    const b = await makeBuilding(sql);
    const id = await insertBackdated(
      sql,
      { buildingId: b.buildingId, kind: "income", amountRial: 100_000n, occurredOn: MEHR_5, title: "اجاره پشت‌بام", createdBy: b.userId },
      31,
    );
    await expect(sql`UPDATE ledger_entries SET title = 'x' WHERE id = ${id}`).rejects.toThrow(/locked/);
    await expect(sql`DELETE FROM ledger_entries WHERE id = ${id}`).rejects.toThrow(/locked/);
    // Setting locked_at alone is still allowed.
    await lockEntries(sql, [id]);
  });

  it("UPDATE on a draft works and creates no version", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 8_000_000);
    const { entry, revised } = await editEntry(sql, { id: e.id, changes: { amountRial: 85_000_000n }, by: b.userId });
    expect(revised).toBe(false);
    expect(entry.id).toBe(e.id);
    expect(entry.amountRial).toBe(85_000_000n);
    const [{ count }] = await sql<{ count: bigint }[]>`
      SELECT count(*) FROM ledger_entries WHERE building_id = ${b.buildingId}`;
    expect(count).toBe(1n);
  });

  it("issuing a charge locks every entry of that month, and only that month", async () => {
    const b = await makeBuilding(sql);
    const mehr = await expense(b, 1_000_000);
    const aban = await expense(b, 1_000_000, { occurredOn: ABAN_5 });
    await lockMonth(sql, b.buildingId, 1405, 7);
    const rows = await sql<{ id: string; lockedAt: Date | null }[]>`
      SELECT id, locked_at FROM ledger_entries WHERE building_id = ${b.buildingId}`;
    expect(rows.find((r) => r.id === mehr.id)?.lockedAt).not.toBeNull();
    expect(rows.find((r) => r.id === aban.id)?.lockedAt).toBeNull();
  });

  it("opening the resident page locks the entries it shows", async () => {
    const b = await makeBuilding(sql);
    const shown = await expense(b, 1_000_000);
    const other = await expense(b, 2_000_000, { occurredOn: ABAN_5 });
    const rows = await loadLedger(sql, b.buildingId);
    const row = rows.find((r) => r.entry.id === shown.id)!;
    await lockEntries(sql, row.entryIds);

    await expect(editEntry(sql, { id: shown.id, changes: { title: "x" }, by: b.userId })).rejects.toThrow(
      LedgerError,
    );
    const { revised } = await editEntry(sql, { id: other.id, changes: { title: "y" }, by: b.userId });
    expect(revised).toBe(false);
  });

  it("editing a locked entry without a reason fails, in the app and in the database", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 8_000_000);
    await lockEntries(sql, [e.id]);
    await expect(
      editEntry(sql, { id: e.id, changes: { amountRial: 85_000_000n }, reason: " ", by: b.userId }),
    ).rejects.toMatchObject({ code: "reason_required" });
    await expect(sql`
      INSERT INTO ledger_entries (building_id, kind, amount_rial, occurred_on, title, doc_state, supersedes_id, created_by)
      VALUES (${b.buildingId}, 'expense', 850000000, ${MEHR_5}, 'x', 'pending_doc', ${e.id}, ${b.userId})`).rejects.toThrow(
      /edit_needs_reason/,
    );
  });

  it("an entry edited three times is one ledger row with four history events", async () => {
    const b = await makeBuilding(sql);
    let e = await expense(b, 8_000_000);
    const amounts = [8_500_000, 8_400_000, 8_450_000];
    for (const [i, toman] of amounts.entries()) {
      await lockEntries(sql, [e.id]);
      ({ entry: e } = await editEntry(sql, {
        id: e.id,
        changes: { amountRial: BigInt(toman) * 10n },
        reason: `اصلاح شماره ${i + 1}`,
        by: b.userId,
      }));
    }
    const rows = await loadLedger(sql, b.buildingId);
    expect(rows).toHaveLength(1);
    expect(rows[0].edited).toBe(true);
    expect(rows[0].entry.amountRial).toBe(84_500_000n);
    expect(rows[0].history.map((h) => h.type)).toEqual(["created", "edited", "edited", "edited"]);
    expect(rows[0].history.map((h) => h.reason)).toEqual([null, "اصلاح شماره 1", "اصلاح شماره 2", "اصلاح شماره 3"]);
  });

  it("the resident sees exactly the history the manager sees", async () => {
    // Both pages build rows with loadLedger; this checks the history is complete and that
    // the lock a resident view triggers changes nothing in it.
    const b = await makeBuilding(sql);
    const e = await expense(b, 8_000_000);
    await lockEntries(sql, [e.id]);
    await editEntry(sql, { id: e.id, changes: { amountRial: 85_000_000n }, reason: "فاکتور نهایی بیشتر بود", by: b.userId });
    const manager = await loadLedger(sql, b.buildingId);
    await lockEntries(sql, manager.flatMap((r) => r.entryIds));
    const resident = await loadLedger(sql, b.buildingId);
    expect(resident.map((r) => r.history)).toEqual(manager.map((r) => r.history));
    expect(resident[0].history.at(-1)?.reason).toBe("فاکتور نهایی بیشتر بود");
  });

  it("an undocumented expense without a note fails", async () => {
    const b = await makeBuilding(sql);
    await expect(expense(b, 500_000, { docState: "undocumented" })).rejects.toThrow(/undocumented_needs_note/);
    await expense(b, 500_000, { docState: "undocumented", undocumentedNote: "خرید نقدی از دستفروش" });
  });

  it("attaching a document later is a new event with no amount and updates the label", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 8_000_000);
    await lockEntries(sql, [e.id]);
    const before = await buildingBalance(sql, b.buildingId);
    const event = await attachDocument(sql, { targetId: e.id, file, by: b.userId });
    expect(event.amountRial).toBeNull();
    const [row] = await loadLedger(sql, b.buildingId);
    expect(row.docState).toBe("documented");
    expect(row.edited).toBe(false);
    expect(row.history.map((h) => h.type)).toEqual(["created", "document"]);
    expect(await buildingBalance(sql, b.buildingId)).toBe(before);
  });

  it("the fund balance after an edit shows the new value and counts it once", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 8_000_000);
    await lockEntries(sql, [e.id]);
    expect(await buildingBalance(sql, b.buildingId)).toBe(-80_000_000n);

    const { entry } = await editEntry(sql, { id: e.id, changes: { amountRial: 85_000_000n }, reason: "فاکتور نهایی", by: b.userId });
    expect(await buildingBalance(sql, b.buildingId)).toBe(-85_000_000n);

    await voidEntry(sql, { id: entry.id, reason: "تکراری ثبت شده بود", by: b.userId });
    expect(await buildingBalance(sql, b.buildingId)).toBe(0n);
    const [row] = await loadLedger(sql, b.buildingId);
    expect(row.voided).toBe(true);
  });

  it("a payment lowers the unit's debt and raises the fund balance", async () => {
    const b = await makeBuilding(sql);
    const unitId = b.unitIds[0];
    await issueChargeRow(b, unitId, 1_500_000);
    expect(await unitDebt(sql, unitId)).toBe(15_000_000n);
    expect(await buildingBalance(sql, b.buildingId)).toBe(0n); // a charge is owed, not cash

    const pay = await createEntry(sql, {
      buildingId: b.buildingId,
      kind: "payment",
      amountRial: 10_000_000n,
      occurredOn: MEHR_5,
      title: "پرداخت شارژ",
      unitId,
      createdBy: b.userId,
    });
    expect(await unitDebt(sql, unitId)).toBe(5_000_000n);
    expect(await buildingBalance(sql, b.buildingId)).toBe(10_000_000n);

    await lockEntries(sql, [pay.id]);
    await voidEntry(sql, { id: pay.id, reason: "چک برگشت خورد", by: b.userId });
    expect(await unitDebt(sql, unitId)).toBe(15_000_000n);
    expect(await buildingBalance(sql, b.buildingId)).toBe(0n);
  });
});

describe("database guards", () => {
  it("app_user cannot TRUNCATE the ledger", async () => {
    await expect(sql`TRUNCATE ledger_entries CASCADE`).rejects.toThrow(/permission denied/);
  });

  it("created_at cannot be in the future", async () => {
    const b = await makeBuilding(sql);
    await expect(
      insertBackdated(
        sql,
        { buildingId: b.buildingId, kind: "income", amountRial: 10n, occurredOn: MEHR_5, title: "x", createdBy: b.userId },
        -60,
      ),
    ).rejects.toThrow(/future/);
  });

  it("a draft's created_at cannot be changed to stretch the window", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 1_000);
    await expect(
      sql`UPDATE ledger_entries SET created_at = created_at - interval '1 minute' WHERE id = ${e.id}`,
    ).rejects.toThrow(/created_at/);
  });

  it("a reversal must carry its target's amount", async () => {
    const b = await makeBuilding(sql);
    const e = await expense(b, 1_000);
    await expect(sql`
      INSERT INTO ledger_entries (building_id, kind, amount_rial, occurred_on, title, target_id, edit_reason, created_by)
      VALUES (${b.buildingId}, 'reversal', 20, ${MEHR_5}, 'x', ${e.id}, 'دلیل', ${b.userId})`).rejects.toThrow(
      /amount of its target/,
    );
  });

  it("amounts must be whole toman", async () => {
    const b = await makeBuilding(sql);
    await expect(
      createEntry(sql, { buildingId: b.buildingId, kind: "income", amountRial: 15n, occurredOn: MEHR_5, title: "x", createdBy: b.userId }),
    ).rejects.toThrow(/amount_whole_toman/);
  });
});
