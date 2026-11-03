import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import { GoogleAuthError, SCOPE_DRAFTS, SCOPE_READ, refreshAccessToken, revokeToken, type Fetcher, type TokenResponse } from "./oauth";

type Db = NodePgDatabase<typeof schema>;
const { googleAccount } = schema;

export type Account = typeof googleAccount.$inferSelect;

export async function getAccount(db: Db): Promise<Account | null> {
  const [a] = await db.select().from(googleAccount).where(eq(googleAccount.id, 1));
  return a ?? null;
}

export const hasScope = (a: Pick<Account, "scopes"> | null, scope: string) => !!a && a.scopes.split(" ").includes(scope);
export const canRead = (a: Account | null) => !!a?.refreshTokenEnc && hasScope(a, SCOPE_READ);
export const canDraft = (a: Account | null) => !!a?.refreshTokenEnc && hasScope(a, SCOPE_DRAFTS);

// Access tokens live about an hour; keep one in memory instead of refreshing on every call.
const cache = globalThis as unknown as { __scoutlineGoogle?: { token: string; exp: number; scopes: string } };

/** Saves what Google granted. Keeps the old refresh token if Google didn't send a new one. */
export async function saveGrant(db: Db, email: string, t: TokenResponse): Promise<void> {
  const cur = await getAccount(db);
  const sameEmail = cur?.email === email;
  const refreshTokenEnc = t.refresh_token ? await encryptSecret(t.refresh_token) : sameEmail ? cur?.refreshTokenEnc ?? null : null;
  const scopes = t.scope ?? "";
  // No refresh token at all means Gmail can't be read until you connect again.
  const prevStatus = sameEmail && cur?.lastSyncStatus !== "reconnect" ? cur?.lastSyncStatus ?? null : null;
  const row = { email, refreshTokenEnc, scopes, lastSyncStatus: refreshTokenEnc ? prevStatus : "reconnect" };
  await db
    .insert(googleAccount)
    .values({ id: 1, ...row, connectedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: googleAccount.id, set: sameEmail ? row : { ...row, syncedThrough: null, lastSyncAt: null, lastSyncError: null, lastSyncSummary: null, connectedAt: new Date().toISOString() } });
  cache.__scoutlineGoogle = { token: t.access_token, exp: Date.now() + (t.expires_in - 120) * 1000, scopes };
}

/** A fresh access token for Gmail calls. Marks the account "reconnect" if Google revoked access. */
export async function accessToken(db: Db, fetcher?: Fetcher): Promise<string> {
  const c = cache.__scoutlineGoogle;
  const a = await getAccount(db);
  if (!a?.refreshTokenEnc) throw new GoogleAuthError("not_connected", "Gmail isn't connected");
  if (c && c.exp > Date.now() && c.scopes === a.scopes) return c.token;
  try {
    const t = await refreshAccessToken(await decryptSecret(a.refreshTokenEnc), fetcher);
    cache.__scoutlineGoogle = { token: t.access_token, exp: Date.now() + (t.expires_in - 120) * 1000, scopes: a.scopes };
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "invalid_grant") {
      await db.update(googleAccount).set({ lastSyncStatus: "reconnect", lastSyncError: "Google access was removed or expired. Connect Gmail again." }).where(eq(googleAccount.id, 1));
    }
    throw e;
  }
}

/** Forgets the Google connection here and asks Google to revoke it. */
export async function disconnect(db: Db, fetcher?: Fetcher): Promise<void> {
  const a = await getAccount(db);
  if (a?.refreshTokenEnc) {
    const rt = await decryptSecret(a.refreshTokenEnc).catch(() => null);
    if (rt) await revokeToken(rt, fetcher);
  }
  await db.delete(googleAccount).where(eq(googleAccount.id, 1));
  cache.__scoutlineGoogle = undefined;
}

export function clearTokenCacheForTests() {
  cache.__scoutlineGoogle = undefined;
}
