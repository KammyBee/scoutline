// Encrypts the Google refresh token before it goes in the database (AES-256-GCM, Web Crypto).
// The key comes from SESSION_SECRET, so changing that secret means connecting Google again.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function key(secret = process.env.SESSION_SECRET): Promise<CryptoKey> {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 random characters");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("scoutline-google-token:" + secret));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** "v1.<iv>.<ciphertext>" */
export async function encryptSecret(plain: string, secret?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(plain));
  return "v1." + b64url(iv) + "." + b64url(new Uint8Array(ct));
}

export async function decryptSecret(box: string, secret?: string): Promise<string> {
  const [v, iv, ct] = box.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("Unrecognized token format");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(iv, "base64url") }, await key(secret), Buffer.from(ct, "base64url"));
  return dec.decode(pt);
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier))));
}
