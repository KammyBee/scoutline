import { Suspense } from "react";
import { googleSignInConfigured } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Scoutline" };

const ERRORS: Record<string, string> = {
  wrong_account: "That Google account isn't the one allowed to use Scoutline.",
  unverified: "Google says that email address isn't verified.",
  denied: "Google sign-in was cancelled.",
  state: "The sign-in link expired. Try again.",
  google_error: "Google sign-in didn't work. Try again in a moment.",
  google_off: "Google sign-in isn't set up. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_ALLOWED_EMAIL.",
  signin_first: "Sign in first, then connect Gmail.",
};

async function Form({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <LoginForm next={next ?? "/"} google={googleSignInConfigured()} password={!!process.env.APP_PASSWORD} error={error ? ERRORS[error] ?? ERRORS.google_error : undefined} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return (
    <main className="login">
      <div className="panel login-card">
        <p className="eyebrow">Job search pipeline</p>
        <h1>Scoutline</h1>
        <Suspense fallback={<div className="login-form" />}>
          <Form searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
