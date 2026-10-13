import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appDb, makeBuilding, ownerDb } from "@/test/support";
import { LocalFileStore, assertSafeKey } from "./files";
import { documentForManager, keyBelongsTo, MAX_DOCUMENT_BYTES, sniffType, storeUpload } from "./documents";
import { MockReceiptExtractor } from "./receipt";
import { createEntry, editEntry, loadLedger, lockEntries } from "./ledger";
import { jalaliInputValue, parseJalaliInput } from "./date";

const sql = appDb();
afterAll(async () => {
  await sql.end();
  await ownerDb().end();
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PDF = Buffer.from("%PDF-1.7 test");

async function tempStore() {
  return new LocalFileStore(await mkdtemp(path.join(tmpdir(), "ledger-files-")));
}

describe("uploads", () => {
  it("reads the file type from its bytes, not its name", () => {
    expect(sniffType(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffType(PDF)?.mime).toBe("application/pdf");
    expect(sniffType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffType(Buffer.from("<html>"))).toBeNull();
  });

  it("stores accepted files under the building and refuses the rest", async () => {
    const store = await tempStore();
    const info = await storeUpload(store, "11111111-1111-1111-1111-111111111111", JPEG);
    expect(info).toMatchObject({ mimeType: "image/jpeg", byteSize: JPEG.length });
    expect(keyBelongsTo(info.storageKey, "11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(keyBelongsTo(info.storageKey, "22222222-2222-2222-2222-222222222222")).toBe(false);
    expect(await store.get(info.storageKey)).toEqual(JPEG);

    await expect(storeUpload(store, "x", Buffer.from("not an image"))).rejects.toThrow(/PDF/);
    await expect(storeUpload(store, "x", Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0xff))).rejects.toThrow(/۱۰ مگابایت/);
  });

  it("refuses storage keys that could escape the folder", () => {
    for (const bad of ["../etc/passwd.txt", "b/../../x.jpg", "/abs/x.jpg", "b//x.jpg", "b/x"]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
    expect(() => assertSafeKey("b/1f2e/abc-123.jpg")).not.toThrow();
  });

  it("the mock extractor answers with confidence 0.8", async () => {
    const r = await new MockReceiptExtractor(0).extract(JPEG, "image/jpeg");
    expect(r.confidence).toBe(0.8);
    expect(r.amountRial).toBeGreaterThan(0n);
  });
});

describe("documents and edits", () => {
  it("a manager can open only their own building's documents", async () => {
    const mine = await makeBuilding(sql, 1);
    const theirs = await makeBuilding(sql, 1);
    const e = await createEntry(
      sql,
      { buildingId: mine.buildingId, kind: "expense", amountRial: 10_000n, occurredOn: "2026-10-01", title: "x", docState: "documented", createdBy: mine.userId },
      { storageKey: `b/${mine.buildingId}/00000000-0000-0000-0000-000000000000.jpg`, mimeType: "image/jpeg", byteSize: 7 },
    );
    const [doc] = await sql<{ id: string }[]>`SELECT id FROM documents WHERE entry_id = ${e.id}`;
    expect(await documentForManager(sql, doc.id, mine.userId)).not.toBeNull();
    expect(await documentForManager(sql, doc.id, theirs.userId)).toBeNull();
  });

  it("saving a locked entry without changing anything creates no revision", async () => {
    const b = await makeBuilding(sql, 1);
    const e = await createEntry(sql, {
      buildingId: b.buildingId, kind: "income", amountRial: 10_000n, occurredOn: "2026-10-01", title: "اجاره", createdBy: b.userId,
    });
    await lockEntries(sql, [e.id]);
    const { revised } = await editEntry(sql, {
      id: e.id, changes: { amountRial: 10_000n, title: "اجاره", occurredOn: "2026-10-01", note: null }, by: b.userId,
    });
    expect(revised).toBe(false);
    const [row] = await loadLedger(sql, b.buildingId);
    expect(row.edited).toBe(false);
  });
});

describe("Jalali date input", () => {
  it("round-trips and accepts Persian digits and separators", () => {
    expect(jalaliInputValue("2026-10-13")).toBe("۱۴۰۵/۰۷/۲۱");
    expect(parseJalaliInput("۱۴۰۵/۰۷/۲۱")).toBe("2026-10-13");
    expect(parseJalaliInput("1405-7-21")).toBe("2026-10-13");
    expect(parseJalaliInput("1404/12/30")).toBeNull(); // 1404 is not a leap year
    expect(parseJalaliInput("1403/12/30")).toBe("2025-03-20");
    expect(parseJalaliInput("hello")).toBeNull();
  });
});
