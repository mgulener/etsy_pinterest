"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const initialState: LoginState = { error: "" };
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="login-shell">
      <form action={formAction} className="login-panel">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Etsy Social Automation</h1>
        </div>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {state.error ? <p className="error-text">{state.error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
