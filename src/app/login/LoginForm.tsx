"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next, google, password, error }: { next: string; google: boolean; password: boolean; error?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  const shownError = state.error ?? error;
  return (
    <div className="login-form">
      {google ? (
        <a className="btn primary google-btn" href={"/auth/google?purpose=signin&next=" + encodeURIComponent(next)}>
          Sign in with Google
        </a>
      ) : null}
      {google && password ? <p className="login-or">or use your password</p> : null}
      {password || !google ? (
        <form action={action} className="login-form">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus={!google} />
          <button className={"btn" + (google ? "" : " primary")} type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {shownError ? <p className="err" role="alert">{shownError}</p> : null}
    </div>
  );
}
