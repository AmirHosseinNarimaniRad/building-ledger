// A realistic sample building. Clean data hides bugs, so this one has unsorted unit numbers,
// mixed areas, an empty unit, a unit of six, and entries in every document state.
import { connect, type Db } from "../lib/db";
import { fromJalali } from "../lib/date";
import { createEntry, editEntry, type Entry } from "../lib/ledger";

const MANAGER_PHONE = "+989120000000";
const fa = new Intl.NumberFormat("fa-IR", { useGrouping: false });

// [floor, unit on floor, area m², occupants]
const UNITS: [number, number, number, number][] = [
  [3, 2, 118.4, 4], [1, 1, 92.5, 3], [5, 4, 145.2, 6], [2, 3, 76.0, 2], [4, 1, 101.3, 3],
  [1, 4, 62.5, 1], [3, 4, 118.4, 0], [2, 1, 92.5, 4], [5, 1, 131.0, 2], [4, 3, 76.0, 2],
  [1, 2, 88.0, 2], [2, 4, 62.5, 1], [3, 1, 92.5, 3], [4, 4, 101.3, 5], [5, 2, 131.0, 3],
  [1, 3, 76.0, 2], [3, 3, 76.0, 1], [2, 2, 88.0, 3], [4, 2, 88.0, 2], [5, 3, 99.9, 4],
];

const toman = (n: number) => BigInt(n) * 10n;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

async function backdated(sql: Db, row: Record<string, unknown>, createdAt: Date): Promise<Entry> {
  const [entry] = await sql<Entry[]>`INSERT INTO ledger_entries ${sql({ ...row, createdAt })} RETURNING *`;
  return entry;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = connect(url);

  const [existing] = await sql`SELECT id FROM users WHERE phone = ${MANAGER_PHONE}`;
  if (existing) {
    console.log("already seeded (run npm run db:reset to start over)");
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    const [manager] = await tx<{ id: string }[]>`
      INSERT INTO users (phone, display_name) VALUES (${MANAGER_PHONE}, 'امیرحسین') RETURNING id`;
    const [building] = await tx<{ id: string }[]>`
      INSERT INTO buildings (name, address, manager_id)
      VALUES ('ساختمان نمونه یاس', 'تهران، خیابان نمونه، پلاک ۱۲', ${manager.id}) RETURNING id`;

    for (const [i, [floor, n, area, occupants]] of UNITS.entries()) {
      await tx`
        INSERT INTO units (building_id, label, sort_key, area_m2, occupants, resident_name, phone)
        VALUES (${building.id}, ${fa.format(floor * 100 + n)}, ${floor * 10 + n}, ${area}, ${occupants},
                ${occupants === 0 ? null : `ساکن واحد ${fa.format(floor * 100 + n)}`},
                ${occupants === 0 ? null : `+98912100${String(i).padStart(4, "0")}`})`;
    }

    const base = { buildingId: building.id, createdBy: manager.id };

    await backdated(tx, {
      ...base, kind: "expense", amountRial: toman(2_350_000), occurredOn: fromJalali(1405, 6, 10),
      title: "قبض برق مشاعات", category: "قبوض", docState: "pending_doc",
    }, daysAgo(40));

    await backdated(tx, {
      ...base, kind: "expense", amountRial: toman(900_000), occurredOn: fromJalali(1405, 6, 25),
      title: "شارژ کپسول آتش‌نشانی", category: "ایمنی", docState: "undocumented",
      undocumentedNote: "فروشنده فاکتور نداد",
    }, daysAgo(26));

    // The spec's own example: entered at the pre-invoice price, corrected after it was locked.
    const elevator = await backdated(tx, {
      ...base, kind: "expense", amountRial: toman(8_000_000), occurredOn: fromJalali(1405, 7, 12),
      title: "تعمیر آسانسور", category: "تعمیرات", docState: "pending_doc",
    }, daysAgo(9));
    await editEntry(tx, {
      id: elevator.id,
      changes: { amountRial: toman(8_500_000) },
      reason: "فاکتور نهایی بیشتر از پیش‌فاکتور بود",
      by: manager.id,
    });

    await backdated(tx, {
      ...base, kind: "income", amountRial: toman(3_000_000), occurredOn: fromJalali(1405, 7, 8),
      title: "اجاره پشت‌بام برای آنتن", category: "درآمد",
    }, daysAgo(13));

    // Fresh, still a draft for 30 minutes.
    await createEntry(tx, {
      ...base, kind: "expense", amountRial: toman(1_200_000), occurredOn: fromJalali(1405, 7, 20),
      title: "نظافت راه‌پله", category: "نظافت", docState: "pending_doc",
    });
  });

  console.log(`seeded: manager ${MANAGER_PHONE}, 20 units, 5 ledger rows (one edited)`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
