"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { requireBuilding } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files";
import { keyBelongsTo, sniffType, storeUpload, UploadError } from "@/lib/documents";
import { getReceiptExtractor, MIN_CONFIDENCE } from "@/lib/receipt";
import { jalaliInputValue, parseJalaliInput, todayTehran } from "@/lib/date";
import { MoneyInputError, tomanInputToRial } from "@/lib/money";
import {
  attachDocument,
  createEntry,
  editEntry,
  LedgerError,
  voidEntry,
  type DocState,
  type EntryChanges,
  type FileInfo,
} from "@/lib/ledger";

export interface FormState {
  error?: string;
  fields?: Record<string, string>;
}

const LEDGER_MESSAGES: Record<string, string> = {
  not_found: "این ردیف پیدا نشد",
  not_editable: "این نوع ردیف ویرایش نمی‌شود",
  not_latest: "این نسخه قدیمی است؛ آخرین نسخه را ویرایش کنید",
  reason_required: "دلیل تغییر را بنویسید (دست‌کم ۳ حرف)؛ ساکنان هم آن را می‌بینند",
  already_voided: "این ردیف قبلاً حذف شده است",
};

function text(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function ledgerUrl(buildingId: string) {
  return `/app/b/${buildingId}/ledger`;
}

/** Shared field reading for money forms; returns an error message instead of throwing. */
function readAmount(form: FormData): bigint | string {
  try {
    return tomanInputToRial(text(form, "amount"));
  } catch (err) {
    if (err instanceof MoneyInputError) return err.message;
    throw err;
  }
}

function readDate(form: FormData): string | { error: string } {
  const raw = text(form, "date");
  if (!raw) return todayTehran();
  const iso = parseJalaliInput(raw);
  if (!iso) return { error: "تاریخ را مثل ۱۴۰۵/۰۷/۲۱ وارد کنید" };
  if (iso > todayTehran()) return { error: "تاریخ نمی‌تواند در آینده باشد" };
  return iso;
}

// ---------- expense from a photo: step 1, upload and read ----------

export interface UploadState {
  error?: string;
  storageKey?: string;
  mimeType?: string;
  prefill?: { amount: string; title: string; date: string; note: string };
  lowConfidence?: boolean;
}

export async function uploadReceiptAction(buildingId: string, _prev: UploadState, form: FormData): Promise<UploadState> {
  await requireBuilding(buildingId);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "عکس فاکتور را انتخاب کنید" };

  const data = Buffer.from(await file.arrayBuffer());
  const store = getFileStore();
  let info: FileInfo;
  try {
    info = await storeUpload(store, buildingId, data);
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    throw err;
  }

  const extracted = await getReceiptExtractor().extract(data, info.mimeType);
  // Keep the raw reading next to the file; it is saved with the document on confirm.
  await store.put(info.storageKey.replace(/\.\w+$/, "-x.json"), Buffer.from(JSON.stringify(extracted.raw)));

  const lowConfidence = extracted.confidence < MIN_CONFIDENCE;
  const fmt = new Intl.NumberFormat("fa-IR");
  return {
    storageKey: info.storageKey,
    mimeType: info.mimeType,
    lowConfidence,
    prefill: lowConfidence
      ? { amount: "", title: "", date: jalaliInputValue(todayTehran()), note: "" }
      : {
          amount: extracted.amountRial ? fmt.format(extracted.amountRial / 10n) : "",
          title: extracted.payee ?? "",
          date: jalaliInputValue(extracted.occurredOn ?? todayTehran()),
          note: extracted.traceNumber ? `شماره پیگیری ${extracted.traceNumber}` : "",
        },
  };
}

// ---------- expense: create (photo confirm or manual) ----------

export async function createExpenseAction(buildingId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireBuilding(buildingId);
  const fields = Object.fromEntries(["amount", "title", "note", "date"].map((k) => [k, text(form, k)]));

  const amount = readAmount(form);
  if (typeof amount === "string") return { error: amount, fields };
  const title = text(form, "title");
  if (!title) return { error: "بابت چه هزینه‌ای است؟", fields };
  const date = readDate(form);
  if (typeof date !== "string") return { error: date.error, fields };
  const note = text(form, "note") || null;

  // With a photo: the stored file must be this building's and still exist.
  let file: FileInfo | undefined;
  const storageKey = text(form, "storageKey");
  if (storageKey) {
    const store = getFileStore();
    const data = keyBelongsTo(storageKey, buildingId) ? await store.get(storageKey) : null;
    const type = data && sniffType(data);
    if (!data || !type) return { error: "فایل فاکتور پیدا نشد؛ دوباره بارگذاری کنید", fields };
    const raw = await store.get(storageKey.replace(/\.\w+$/, "-x.json"));
    file = { storageKey, mimeType: type.mime, byteSize: data.length, extracted: raw ? JSON.parse(raw.toString()) : undefined };
  }

  const noDoc = form.get("noDocument") === "on";
  if (!file && noDoc && (!note || note.length < 3)) {
    return { error: "برای هزینه بدون سند، در «توضیح» بنویسید چرا سند ندارد", fields };
  }
  const docState: DocState = file ? "documented" : noDoc ? "undocumented" : "pending_doc";

  await createEntry(
    db(),
    {
      buildingId,
      kind: "expense",
      amountRial: amount,
      occurredOn: date,
      title,
      note,
      docState,
      undocumentedNote: docState === "undocumented" ? note : null,
      createdBy: user.id,
    },
    file,
  );
  redirect(ledgerUrl(buildingId));
}

// ---------- payments and other income ----------

export async function createReceiptAction(buildingId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { user } = await requireBuilding(buildingId);
  const fields = Object.fromEntries(["kind", "unitId", "amount", "title", "date", "note"].map((k) => [k, text(form, k)]));

  const amount = readAmount(form);
  if (typeof amount === "string") return { error: amount, fields };
  const date = readDate(form);
  if (typeof date !== "string") return { error: date.error, fields };
  const note = text(form, "note") || null;

  if (fields.kind === "income") {
    if (!fields.title) return { error: "بابت چه درآمدی است؟", fields };
    await createEntry(db(), {
      buildingId, kind: "income", amountRial: amount, occurredOn: date, title: fields.title, note, createdBy: user.id,
    });
  } else {
    const [unit] = await db()<{ label: string }[]>`
      SELECT label FROM units WHERE id = ${fields.unitId || null} AND building_id = ${buildingId}`;
    if (!unit) return { error: "واحد را انتخاب کنید", fields };
    await createEntry(db(), {
      buildingId, kind: "payment", amountRial: amount, occurredOn: date,
      title: `پرداخت واحد ${unit.label}`, unitId: fields.unitId, note, createdBy: user.id,
    });
  }
  redirect(ledgerUrl(buildingId));
}

// ---------- edit and delete ----------

export async function editEntryAction(
  buildingId: string,
  entryId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireBuilding(buildingId);
  const fields = Object.fromEntries(
    ["amount", "title", "note", "date", "docState", "reason"].map((k) => [k, text(form, k)]),
  );

  const amount = readAmount(form);
  if (typeof amount === "string") return { error: amount, fields };
  if (!fields.title) return { error: "عنوان لازم است", fields };
  const date = readDate(form);
  if (typeof date !== "string") return { error: date.error, fields };

  const changes: EntryChanges = { amountRial: amount, title: fields.title, occurredOn: date, note: fields.note || null };
  if (fields.docState === "pending_doc" || fields.docState === "undocumented") {
    changes.docState = fields.docState;
    changes.undocumentedNote = fields.docState === "undocumented" ? fields.note || null : null;
    if (fields.docState === "undocumented" && (fields.note ?? "").length < 3) {
      return { error: "برای هزینه بدون سند، در «توضیح» بنویسید چرا سند ندارد", fields };
    }
  }

  try {
    await assertInBuilding(buildingId, entryId);
    await editEntry(db(), { id: entryId, changes, reason: fields.reason, by: user.id });
  } catch (err) {
    if (err instanceof LedgerError) return { error: LEDGER_MESSAGES[err.code], fields };
    throw err;
  }
  redirect(ledgerUrl(buildingId));
}

export async function voidEntryAction(
  buildingId: string,
  entryId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireBuilding(buildingId);
  const reason = text(form, "reason");
  try {
    await assertInBuilding(buildingId, entryId);
    await voidEntry(db(), { id: entryId, reason, by: user.id });
  } catch (err) {
    if (err instanceof LedgerError) return { error: LEDGER_MESSAGES[err.code], fields: { reason } };
    throw err;
  }
  redirect(ledgerUrl(buildingId));
}

// ---------- attach a document to an older expense ----------

export async function attachDocumentAction(
  buildingId: string,
  entryId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const { user } = await requireBuilding(buildingId);
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "فایل سند را انتخاب کنید" };
  try {
    await assertInBuilding(buildingId, entryId);
    const info = await storeUpload(getFileStore(), buildingId, Buffer.from(await file.arrayBuffer()));
    await attachDocument(db(), { targetId: entryId, file: info, by: user.id });
  } catch (err) {
    if (err instanceof UploadError) return { error: err.message };
    if (err instanceof LedgerError) return { error: LEDGER_MESSAGES[err.code] };
    throw err;
  }
  redirect(ledgerUrl(buildingId));
}

/** The entry id comes from the URL: make sure it is in the building the user manages. */
async function assertInBuilding(buildingId: string, entryId: string) {
  if (!isUuid(entryId)) throw new LedgerError("not_found");
  const [row] = await db()`SELECT 1 FROM ledger_entries WHERE id = ${entryId} AND building_id = ${buildingId}`;
  if (!row) throw new LedgerError("not_found");
}
