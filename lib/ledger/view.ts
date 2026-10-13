import type { Db } from "@/lib/db";
import type { DocState, Entry } from "./types";

export type HistoryEventType = "created" | "edited" | "document" | "voided";

export interface HistoryEvent {
  type: HistoryEventType;
  entryId: string;
  at: Date;
  amountRial: bigint | null;
  reason: string | null;
  docState: DocState | null;
  by: string;
}

/** One row of the ledger list: the latest version of a chain, with its full history. */
export interface LedgerRow {
  entry: Entry;
  docState: DocState | null;
  edited: boolean;
  voided: boolean;
  history: HistoryEvent[];
  /** Every entry this row shows, for locking when a resident sees it. */
  entryIds: string[];
}

function byTime(a: { at: Date }, b: { at: Date }) {
  return a.at.getTime() - b.at.getTime();
}

/**
 * Builds the ledger list from all of a building's entries.
 * The manager and resident pages both use this, so they always show the same history.
 */
export function buildLedger(entries: Entry[]): LedgerRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const successorOf = new Map<string, Entry>();
  const reversalOf = new Map<string, Entry>();
  const docEventsOf = new Map<string, Entry[]>();

  for (const e of entries) {
    if (e.supersedesId) successorOf.set(e.supersedesId, e);
    if (e.kind === "reversal" && e.targetId) reversalOf.set(e.targetId, e);
    if (e.kind === "document_attached" && e.targetId) {
      docEventsOf.set(e.targetId, [...(docEventsOf.get(e.targetId) ?? []), e]);
    }
  }

  const rows: LedgerRow[] = [];
  for (const head of entries) {
    if (head.kind === "reversal" || head.kind === "document_attached") continue;
    if (successorOf.has(head.id)) continue;

    // Walk back to the first version.
    const chain: Entry[] = [];
    for (let v: Entry | undefined = head; v; v = v.supersedesId ? byId.get(v.supersedesId) : undefined) {
      chain.unshift(v);
    }

    const history: HistoryEvent[] = [];
    const entryIds: string[] = [];
    chain.forEach((v, i) => {
      entryIds.push(v.id);
      history.push({
        type: i === 0 ? "created" : "edited",
        entryId: v.id,
        at: v.createdAt,
        amountRial: v.amountRial,
        reason: i === 0 ? null : v.editReason,
        docState: v.docState,
        by: v.createdBy,
      });
      for (const d of docEventsOf.get(v.id) ?? []) {
        entryIds.push(d.id);
        history.push({
          type: "document",
          entryId: d.id,
          at: d.createdAt,
          amountRial: null,
          reason: null,
          docState: d.docState,
          by: d.createdBy,
        });
      }
      // Reversals made by an edit sit between versions; they are part of the chain too.
      const r = reversalOf.get(v.id);
      if (r) entryIds.push(r.id);
    });

    const voidedBy = reversalOf.get(head.id);
    if (voidedBy) {
      history.push({
        type: "voided",
        entryId: voidedBy.id,
        at: voidedBy.createdAt,
        amountRial: voidedBy.amountRial,
        reason: voidedBy.editReason,
        docState: null,
        by: voidedBy.createdBy,
      });
    }
    history.sort(byTime);

    // Current doc state: the newest of the head's own state and later document events.
    const docEvents = history.filter((h) => h.type === "document" && h.at >= head.createdAt);
    const docState = docEvents.length ? docEvents[docEvents.length - 1].docState : head.docState;

    rows.push({
      entry: head,
      docState,
      edited: chain.length > 1,
      voided: Boolean(voidedBy),
      history,
      entryIds,
    });
  }

  return rows.sort(
    (a, b) =>
      b.entry.occurredOn.localeCompare(a.entry.occurredOn) ||
      b.entry.createdAt.getTime() - a.entry.createdAt.getTime(),
  );
}

export async function loadLedger(sql: Db, buildingId: string): Promise<LedgerRow[]> {
  const entries = await sql<Entry[]>`
    SELECT * FROM ledger_entries WHERE building_id = ${buildingId} ORDER BY created_at, id`;
  return buildLedger(entries);
}
