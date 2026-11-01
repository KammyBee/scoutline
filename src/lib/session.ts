// Single-user sign-in: a password from APP_PASSWORD and a signed, expiring cookie.
// Uses Web Crypto so it runs both in the proxy and in server actions.

export const SESSION_COOKIE = "sl_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 random characters");
  return s;
}

export function authConfigured(): boolean {
  return !!process.env.APP_PASSWORD && !!process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32;
}

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compares a typed password with APP_PASSWORD without leaking timing. */
export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const [a, b] = await Promise.all([hmacHex(secret(), "pw:" + input), hmacHex(secret(), "pw:" + expected)]);
  return sameString(a, b);
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const exp = now + SESSION_DAYS * 864e5;
  return exp + "." + (await hmacHex(secret(), "session:" + exp));
}

export async function sessionValid(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !authConfigured()) return false;
  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!sig || !isFinite(exp) || exp < now) return false;
  return sameString(sig, await hmacHex(secret(), "session:" + exp));
}
