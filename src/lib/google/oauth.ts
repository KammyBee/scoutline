// Google OAuth 2.0 (authorization code + PKCE), written out by hand so it's easy to read and needs no extra package.
// Only three scopes are ever asked for: your email (to sign in), gmail.readonly (to read job mail),
// and, only if you turn on drafts, gmail.compose (to save follow-up drafts).

export const SCOPE_SIGNIN = ["openid", "email"];
export const SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const SCOPE_DRAFTS = "https://www.googleapis.com/auth/gmail.compose";

export type Purpose = "signin" | "connect" | "drafts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: Fetcher = (url, init) => fetch(url, init);

export function googleConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET && !!allowedEmail();
}

/** The one Google account allowed to sign in and connect. */
export function allowedEmail(): string {
  return (process.env.GOOGLE_ALLOWED_EMAIL || "").trim().toLowerCase();
}

export function scopesFor(purpose: Purpose): string[] {
  // Sign-in also connects Gmail read-only, so one consent screen does both.
  const s = [...SCOPE_SIGNIN, SCOPE_READ];
  if (purpose === "drafts") s.push(SCOPE_DRAFTS);
  return s;
}

export function redirectUri(requestUrl: string): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") || new URL(requestUrl).origin;
  return base + "/auth/google/callback";
}

export function authUrl(opts: { purpose: Purpose; state: string; challenge: string; redirectUri: string; loginHint?: string }): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: scopesFor(opts.purpose).join(" "),
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    // Asking for consent again makes Google return a refresh token every time you connect.
    prompt: opts.purpose === "signin" ? "select_account" : "consent",
  });
  const hint = opts.loginHint || allowedEmail();
  if (hint) p.set("login_hint", hint);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

export type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string; token_type?: string };

export class GoogleAuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

async function tokenCall(body: Record<string, string>, fetcher: Fetcher): Promise<TokenResponse> {
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? "", client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "", ...body }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new GoogleAuthError(json.error || "token_error", json.error_description || json.error || `Google token call failed (${res.status})`);
  return json;
}

export function exchangeCode(code: string, verifier: string, redirect: string, fetcher: Fetcher = defaultFetch) {
  return tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirect }, fetcher);
}

export function refreshAccessToken(refreshToken: string, fetcher: Fetcher = defaultFetch) {
  return tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken }, fetcher);
}

/** Asks Google to forget the grant. Best effort. */
export async function revokeToken(token: string, fetcher: Fetcher = defaultFetch): Promise<void> {
  await fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() }).catch(() => undefined);
}

export type IdClaims = { email: string; emailVerified: boolean };

/**
 * Reads the ID token that came straight back from Google's token endpoint over TLS. OpenID Connect allows
 * skipping the signature check in that case, but the issuer, audience and expiry are still checked.
 */
export function readIdToken(idToken: string | undefined, now = Date.now()): IdClaims {
  if (!idToken) throw new GoogleAuthError("no_id_token", "Google didn't return an ID token");
  const part = idToken.split(".")[1];
  if (!part) throw new GoogleAuthError("bad_id_token", "Malformed ID token");
  const c = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean | string };
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") throw new GoogleAuthError("bad_id_token", "Wrong issuer");
  if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new GoogleAuthError("bad_id_token", "Wrong audience");
  if (!c.exp || c.exp * 1000 < now - 60_000) throw new GoogleAuthError("bad_id_token", "Expired ID token");
  return { email: String(c.email ?? "").toLowerCase(), emailVerified: c.email_verified === true || c.email_verified === "true" };
}
