import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: no cookie → login. The real session and ownership checks run in
// requireUser / requireBuilding on every page and action.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("bl_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/app/:path*",
};
