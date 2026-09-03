"use server";

import { redirect } from "next/navigation";
import { clearAdminSession, createAdminSession } from "@/lib/auth/session";
import { getServerEnv } from "@/lib/config/env";

export type LoginState = {
  error: string;
};

export async function loginAction(_previousState: LoginState, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const env = getServerEnv();

  if (password !== env.adminPassword) {
    return { error: "Invalid password" };
  }

  await createAdminSession();
  redirect("/dashboard");
}

export async function logoutAction() {
  await clearAdminSession();
  redirect("/login");
}
