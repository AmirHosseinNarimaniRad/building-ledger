export type EntryKind =
  | "expense"
  | "income"
  | "charge_issued"
  | "payment"
  | "reversal"
  | "document_attached";

export type DocState = "documented" | "pending_doc" | "undocumented";

/** A ledger_entries row, camelCased. */
export interface Entry {
  id: string;
  buildingId: string;
  kind: EntryKind;
  amountRial: bigint | null;
  occurredOn: string;
  title: string;
  category: string | null;
  unitId: string | null;
  periodId: string | null;
  docState: DocState | null;
  undocumentedNote: string | null;
  targetId: string | null;
  supersedesId: string | null;
  editReason: string | null;
  lockedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export type LedgerErrorCode =
  | "not_found"
  | "not_editable"
  | "not_latest"
  | "reason_required"
  | "already_voided";

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}
