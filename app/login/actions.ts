"use server";

import { redirect } from "next/navigation";
import { clearAdminSession, createAdminSession } from "@/lib/auth/session";
import {
  ensureBootstrapAdminFromEnv,
  verifyAdminUserPassword
} from "@/lib/repositories/usersRepository";

export type LoginState = {
  error: string;
};

export async function loginAction(_previousState: LoginState, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  try {
    await ensureBootstrapAdminFromEnv();
    const user = await verifyAdminUserPassword({ email, password });

    if (!user) {
      return { error: "Invalid email or password" };
    }

    await createAdminSession({ id: user.id, email: user.email });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign in failed";
    return { error: message };
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/login");
}
