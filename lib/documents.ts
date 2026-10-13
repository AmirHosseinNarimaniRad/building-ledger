import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import type { FileInfo } from "./ledger";
import type { FileStore } from "./files";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const TYPES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.toString("latin1", 0, 5) === "%PDF-" },
];

export class UploadError extends Error {}

/** The type is read from the file's own bytes, never from what the browser claims. */
export function sniffType(data: Buffer) {
  return TYPES.find((t) => t.test(data)) ?? null;
}

/** Validates and stores an uploaded receipt under the building's folder. */
export async function storeUpload(store: FileStore, buildingId: string, data: Buffer): Promise<FileInfo> {
  if (data.length === 0) throw new UploadError("فایلی انتخاب نشده");
  if (data.length > MAX_DOCUMENT_BYTES) throw new UploadError("حجم فایل بیشتر از ۱۰ مگابایت است");
  const type = sniffType(data);
  if (!type) throw new UploadError("فقط عکس (JPG، PNG، WebP) یا PDF قبول است");
  const storageKey = `b/${buildingId}/${randomUUID()}.${type.ext}`;
  await store.put(storageKey, data);
  return { storageKey, mimeType: type.mime, byteSize: data.length };
}

/** A key the client sends back must point into this building's own folder. */
export function keyBelongsTo(storageKey: string, buildingId: string) {
  return new RegExp(`^b/${buildingId}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`).test(storageKey);
}

export interface DocumentRef {
  id: string;
  entryId: string;
  mimeType: string;
}

/** Every document of a building, grouped by the entry it hangs on. */
export async function documentsByEntry(sql: Db, buildingId: string): Promise<Map<string, DocumentRef[]>> {
  const docs = await sql<DocumentRef[]>`
    SELECT d.id, d.entry_id, d.mime_type FROM documents d
    JOIN ledger_entries e ON e.id = d.entry_id
    WHERE e.building_id = ${buildingId}
    ORDER BY d.uploaded_at`;
  const map = new Map<string, DocumentRef[]>();
  for (const d of docs) map.set(d.entryId, [...(map.get(d.entryId) ?? []), d]);
  return map;
}

/** The document, only if this user manages its building. */
export async function documentForManager(sql: Db, docId: string, userId: string) {
  const [doc] = await sql<{ storageKey: string; mimeType: string }[]>`
    SELECT d.storage_key, d.mime_type FROM documents d
    JOIN ledger_entries e ON e.id = d.entry_id
    JOIN buildings b ON b.id = e.building_id
    WHERE d.id = ${docId} AND b.manager_id = ${userId}`;
  return doc ?? null;
}
