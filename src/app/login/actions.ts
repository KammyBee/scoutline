"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_DAYS, authConfigured, createSessionToken, passwordMatches } from "@/lib/session";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  if (!authConfigured()) return { error: "Sign-in isn't set up yet. Add SESSION_SECRET and APP_PASSWORD (or Google sign-in) to your environment." };
  if (!process.env.APP_PASSWORD) return { error: "Password sign-in is off. Use Sign in with Google." };
  const password = String(form.get("password") ?? "");
  if (!(await passwordMatches(password))) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: "That password didn't match." };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
