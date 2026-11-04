import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { saveGrant } from "@/lib/google/account";
import { SCOPE_DRAFTS, SCOPE_READ, allowedEmail, exchangeCode, googleConfigured, readIdToken, redirectUri } from "@/lib/google/oauth";
import { SESSION_COOKIE, SESSION_DAYS, createSessionToken, sessionValid } from "@/lib/session";
import { OAUTH_COOKIE, readState } from "../state";

function fail(request: NextRequest, error: string, to = "/login") {
  const url = new URL(to, request.url);
  url.searchParams.set("error", error);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/auth/google" });
  return res;
}

// Google sends you back here. Checks the state, swaps the code for tokens, makes sure it's the
// allowed account, then signs you in and/or saves the Gmail connection.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const saved = readState(request.cookies.get(OAUTH_COOKIE)?.value);
  const back = saved && saved.purpose !== "signin" ? "/inbox" : "/login";
  if (!googleConfigured()) return fail(request, "google_off");
  if (p.get("error")) return fail(request, p.get("error") === "access_denied" ? "denied" : "google_error", back);
  const code = p.get("code");
  if (!saved || !code || p.get("state") !== saved.state) return fail(request, "state", back);

  let email: string;
  let tokens;
  try {
    tokens = await exchangeCode(code, saved.verifier, redirectUri(request.url));
    const claims = readIdToken(tokens.id_token);
    if (!claims.emailVerified) return fail(request, "unverified", back);
    email = claims.email;
  } catch (e) {
    console.error("Google sign-in failed", e);
    return fail(request, "google_error", back);
  }
  if (email !== allowedEmail()) return fail(request, "wrong_account", back);

  const signedIn = await sessionValid(request.cookies.get(SESSION_COOKIE)?.value);
  if (saved.purpose !== "signin" && !signedIn) return fail(request, "signin_first");

  // Google lets you untick the Gmail checkbox on its consent screen. Connecting only counts if it was ticked.
  const granted = (tokens.scope ?? "").split(" ");
  if (saved.purpose === "connect" && !granted.includes(SCOPE_READ)) return fail(request, "scope_read", back);
  if (saved.purpose === "drafts" && !granted.includes(SCOPE_DRAFTS)) return fail(request, "scope_drafts", back);
  if (granted.includes(SCOPE_READ)) await saveGrant(await getDb(), email, tokens);

  const res = NextResponse.redirect(new URL(saved.purpose === "signin" ? saved.next : saved.next + (saved.next.includes("?") ? "&" : "?") + "connected=" + saved.purpose, request.url));
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/auth/google" });
  if (saved.purpose === "signin") {
    res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });
  }
  return res;
}
