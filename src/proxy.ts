import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionValid } from "@/lib/session";

// Every page and server action needs a valid session, except the login page itself.
export async function proxy(request: NextRequest) {
  if (await sessionValid(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  const url = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
