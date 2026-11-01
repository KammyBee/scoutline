import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Scoutline" };

async function Form({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={next ?? "/"} />;
}

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
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
