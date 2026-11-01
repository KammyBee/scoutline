import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionValid } from "./session";

/** Server actions check the session themselves too, not only the proxy. */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await sessionValid(token))) throw new Error("Not signed in");
}
