import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { resolveToken } from "@/lib/residents";
import { documentForBuilding } from "@/lib/documents";
import { getFileStore } from "@/lib/files";

// Document images for residents: a valid link of the same building, or nothing.
export async function GET(_req: Request, ctx: RouteContext<"/r/[token]/doc/[docId]">) {
  const { token, docId } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!isUuid(docId)) return notFound();

  const link = await resolveToken(db(), token);
  const doc = link ? await documentForBuilding(db(), docId, link.buildingId) : null;
  if (!doc) return notFound();

  const data = await getFileStore().get(doc.storageKey);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
