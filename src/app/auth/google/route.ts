import { NextResponse, type NextRequest } from "next/server";
import { pkceChallenge, randomToken } from "@/lib/google/crypto";
import { authUrl, googleConfigured, redirectUri, type Purpose } from "@/lib/google/oauth";
import { SESSION_COOKIE, sessionValid } from "@/lib/session";
import { OAUTH_COOKIE, safeNext, writeState } from "./state";

// Starts Google sign-in (?purpose=signin), connecting Gmail read-only (?purpose=connect),
// or turning on Gmail drafts (?purpose=drafts). The last two need you to be signed in already.
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const purpose: Purpose = p.get("purpose") === "drafts" ? "drafts" : p.get("purpose") === "connect" ? "connect" : "signin";
  if (!googleConfigured()) return NextResponse.redirect(new URL("/login?error=google_off", request.url));
  const signedIn = await sessionValid(request.cookies.get(SESSION_COOKIE)?.value);
  if (purpose !== "signin" && !signedIn) return NextResponse.redirect(new URL("/login?next=/inbox", request.url));
  const state = randomToken(24);
  const verifier = randomToken(48);
  const next = safeNext(p.get("next"), purpose === "signin" ? "/" : "/inbox");
  const res = NextResponse.redirect(authUrl({ purpose, state, challenge: await pkceChallenge(verifier), redirectUri: redirectUri(request.url) }));
  res.cookies.set(OAUTH_COOKIE, writeState({ state, verifier, purpose, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 600,
  });
  return res;
}
