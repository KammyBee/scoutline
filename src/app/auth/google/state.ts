import type { Purpose } from "@/lib/google/oauth";

export const OAUTH_COOKIE = "sl_oauth";
export type OAuthState = { state: string; verifier: string; purpose: Purpose; next: string };

export const safeNext = (n: string | null | undefined, fallback = "/") => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : fallback);

export function readState(v: string | undefined): OAuthState | null {
  if (!v) return null;
  try {
    const s = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as OAuthState;
    return s && typeof s.state === "string" && typeof s.verifier === "string" ? s : null;
  } catch {
    return null;
  }
}
export const writeState = (s: OAuthState) => Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
