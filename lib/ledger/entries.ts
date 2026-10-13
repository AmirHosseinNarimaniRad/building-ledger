import { withTx, type Db, type Tx } from "@/lib/db";
import { jalaliMonthRange, todayTehran } from "@/lib/date";
import { LedgerError, type DocState, type Entry } from "./types";

export interface NewEntry {
  buildingId: string;
  kind: "expense" | "income" | "payment" | "charge_issued";
  amountRial: bigint;
  occurredOn: string;
  title: string;
  category?: string | null;
  unitId?: string | null;
  periodId?: string | null;
  docState?: DocState | null;
  undocumentedNote?: string | null;
  note?: string | null;
  createdBy: string;
}

/** Fields a manager can change with "edit". */
export interface EntryChanges {
  amountRial?: bigint;
  occurredOn?: string;
  title?: string;
  category?: string | null;
  unitId?: string | null;
  docState?: DocState;
  undocumentedNote?: string | null;
  note?: string | null;
}

export interface FileInfo {
  storageKey: string;
  mimeType: string;
  byteSize: number;
  extracted?: unknown;
}

const EDITABLE_KINDS = new Set(["expense", "income", "payment"]);

function defined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function insert(sql: Db, row: object): Promise<Entry> {
  const [entry] = await sql<Entry[]>`INSERT INTO ledger_entries ${sql(defined(row))} RETURNING *`;
  return entry;
}

async function addFile(sql: Db, entryId: string, file: FileInfo) {
  await sql`
    INSERT INTO documents (entry_id, storage_key, mime_type, byte_size, extracted)
    VALUES (${entryId}, ${file.storageKey}, ${file.mimeType}, ${file.byteSize},
            ${file.extracted === undefined ? null : sql.json(file.extracted as never)})`;
}

export async function createEntry(sql: Db, input: NewEntry, file?: FileInfo): Promise<Entry> {
  return withTx(sql, async (tx) => {
    const entry = await insert(tx, input);
    if (file) await addFile(tx, entry.id, file);
    return entry;
  });
}

interface CurrentRow extends Entry {
  locked: boolean;
  hasSuccessor: boolean;
  isVoided: boolean;
}

async function loadForChange(tx: Tx, id: string): Promise<CurrentRow> {
  const [cur] = await tx<CurrentRow[]>`
    SELECT e.*,
      ledger_is_locked(e.locked_at, e.created_at) AS locked,
      EXISTS (SELECT 1 FROM ledger_entries n WHERE n.supersedes_id = e.id) AS has_successor,
      EXISTS (SELECT 1 FROM ledger_entries r WHERE r.target_id = e.id AND r.kind = 'reversal') AS is_voided
    FROM ledger_entries e
    WHERE e.id = ${id}
    FOR UPDATE`;
  if (!cur) throw new LedgerError("not_found");
  if (!EDITABLE_KINDS.has(cur.kind)) throw new LedgerError("not_editable");
  if (cur.hasSuccessor) throw new LedgerError("not_latest");
  if (cur.isVoided) throw new LedgerError("already_voided");
  return cur;
}

function requireReason(reason: string | undefined): string {
  if (!reason || reason.trim().length < 3) throw new LedgerError("reason_required");
  return reason.trim();
}

/** Doc state as residents see it now: the latest document event, else the entry's own. */
async function currentDocState(tx: Tx, cur: Entry): Promise<DocState | null> {
  const [last] = await tx<{ docState: DocState }[]>`
    SELECT doc_state FROM ledger_entries
    WHERE target_id = ${cur.id} AND kind = 'document_attached'
    ORDER BY created_at DESC LIMIT 1`;
  return last?.docState ?? cur.docState;
}

/**
 * The one "edit" button. A draft is updated in place and leaves no trace.
 * A locked entry gets a reversal plus a new version, both carrying the reason residents will see.
 */
export async function editEntry(
  sql: Db,
  args: { id: string; changes: EntryChanges; reason?: string; by: string },
): Promise<{ entry: Entry; revised: boolean }> {
  return withTx(sql, async (tx) => {
    const cur = await loadForChange(tx, args.id);
    // Only fields that actually differ count; an untouched "save" must not create a revision.
    const changes = Object.fromEntries(
      Object.entries(defined(args.changes)).filter(([k, v]) => cur[k as keyof Entry] !== v),
    ) as EntryChanges;
    if (Object.keys(changes).length === 0) return { entry: cur, revised: false };

    if (!cur.locked) {
      const [entry] = await tx<Entry[]>`
        UPDATE ledger_entries SET ${tx(changes)} WHERE id = ${cur.id} RETURNING *`;
      return { entry, revised: false };
    }

    const reason = requireReason(args.reason);
    await insert(tx, {
      buildingId: cur.buildingId,
      kind: "reversal",
      amountRial: cur.amountRial,
      occurredOn: cur.occurredOn,
      title: cur.title,
      unitId: cur.unitId,
      targetId: cur.id,
      editReason: reason,
      createdBy: args.by,
    });
    const entry = await insert(tx, {
      buildingId: cur.buildingId,
      kind: cur.kind,
      amountRial: cur.amountRial,
      occurredOn: cur.occurredOn,
      title: cur.title,
      category: cur.category,
      unitId: cur.unitId,
      periodId: cur.periodId,
      docState: await currentDocState(tx, cur),
      undocumentedNote: cur.undocumentedNote,
      note: cur.note,
      ...changes,
      supersedesId: cur.id,
      editReason: reason,
      createdBy: args.by,
    });
    return { entry, revised: true };
  });
}

/** Remove an entry. A draft is deleted outright; a locked entry gets a visible reversal. */
export async function voidEntry(
  sql: Db,
  args: { id: string; reason?: string; by: string },
): Promise<{ deleted: boolean }> {
  return withTx(sql, async (tx) => {
    const cur = await loadForChange(tx, args.id);
    if (!cur.locked && !cur.supersedesId) {
      await tx`DELETE FROM documents WHERE entry_id = ${cur.id}`;
      await tx`DELETE FROM ledger_entries WHERE id = ${cur.id}`;
      return { deleted: true };
    }
    // A draft revision can't just vanish: its predecessor is already reversed. Void it visibly.
    await insert(tx, {
      buildingId: cur.buildingId,
      kind: "reversal",
      amountRial: cur.amountRial,
      occurredOn: cur.occurredOn,
      title: cur.title,
      unitId: cur.unitId,
      targetId: cur.id,
      editReason: requireReason(args.reason),
      createdBy: args.by,
    });
    return { deleted: false };
  });
}

/** Adding a document to an older expense is not an edit: it is a new event in the ledger. */
export async function attachDocument(
  sql: Db,
  args: { targetId: string; file: FileInfo; by: string },
): Promise<Entry> {
  return withTx(sql, async (tx) => {
    const cur = await loadForChange(tx, args.targetId);
    if (cur.kind !== "expense") throw new LedgerError("not_editable", "documents attach to expenses only");
    const event = await insert(tx, {
      buildingId: cur.buildingId,
      kind: "document_attached",
      amountRial: null,
      occurredOn: todayTehran(),
      title: cur.title,
      targetId: cur.id,
      docState: "documented",
      createdBy: args.by,
    });
    await addFile(tx, event.id, args.file);
    return event;
  });
}

/** Lock entries a resident page is about to show. Call before sending the response. */
export async function lockEntries(sql: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`UPDATE ledger_entries SET locked_at = now() WHERE id IN ${sql(ids)} AND locked_at IS NULL`;
}

/** Lock every entry dated in a Jalali month. Runs inside the charge-issue transaction. */
export async function lockMonth(sql: Db, buildingId: string, jy: number, jm: number): Promise<void> {
  const { start, end } = jalaliMonthRange(jy, jm);
  await sql`
    UPDATE ledger_entries SET locked_at = now()
    WHERE building_id = ${buildingId}
      AND occurred_on >= ${start} AND occurred_on < ${end}
      AND locked_at IS NULL`;
}

export async function buildingBalance(sql: Db, buildingId: string): Promise<bigint> {
  const [row] = await sql<{ balanceRial: bigint }[]>`
    SELECT balance_rial FROM building_balances WHERE building_id = ${buildingId}`;
  return row?.balanceRial ?? 0n;
}

export async function unitDebt(sql: Db, unitId: string): Promise<bigint> {
  const [row] = await sql<{ debtRial: bigint }[]>`
    SELECT debt_rial FROM unit_debts WHERE unit_id = ${unitId}`;
  return row?.debtRial ?? 0n;
}
