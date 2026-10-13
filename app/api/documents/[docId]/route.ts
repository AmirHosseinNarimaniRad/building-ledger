import { db } from "@/lib/db";
import { isUuid } from "@/lib/buildings";
import { currentUser } from "@/lib/auth/session";
import { documentForManager } from "@/lib/documents";
import { getFileStore } from "@/lib/files";

// The only non-action endpoint: serves document images, and only to someone allowed to see
// them. (Residents with a valid token for the same building are added in step 5.)
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[docId]">) {
  const { docId } = await ctx.params;
  const notFound = () => new Response("Not found", { status: 404 });
  if (!isUuid(docId)) return notFound();

  const user = await currentUser();
  const doc = user ? await documentForManager(db(), docId, user.id) : null;
  if (!doc) return notFound();

  const data = await getFileStore().get(doc.storageKey);
  if (!data) return notFound();
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
