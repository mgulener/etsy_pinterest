"use client";

import Link from "next/link";
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
        <nav className="login-legal-links" aria-label="Public pages">
          <Link href="/">Home</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/data-deletion">Data deletion</Link>
        </nav>
      </form>
    </main>
  );
}
