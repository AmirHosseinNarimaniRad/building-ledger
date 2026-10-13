import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom } from "./lib/client-ip";

// /r/*: at most 30 requests a minute per IP. In-memory, so per server process — enough for a
// single-server prototype; a shared store is needed once there is more than one instance.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { start: number; count: number }>();

function clientIp(request: NextRequest) {
  return clientIpFrom(request.headers) ?? "local";
}

function overLimit(ip: string) {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (now - v.start > WINDOW_MS) hits.delete(k);
    }
    return false;
  }
  h.count++;
  return h.count > MAX_PER_WINDOW;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/r/")) {
    if (overLimit(clientIp(request))) {
      return new NextResponse("درخواست‌ها زیاد بود؛ یک دقیقه دیگر دوباره امتحان کنید.", {
        status: 429,
        headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" },
      });
    }
    return NextResponse.next();
  }

  // /app/*: optimistic check only. The real session and ownership checks run in
  // requireUser / requireBuilding on every page and action.
  if (!request.cookies.has("bl_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/r/:path*"],
};
