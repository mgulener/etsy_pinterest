import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

export type AdminUser = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
};

export async function findAdminUserByEmail(email: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("admin_users")
    .select("id,email,password_hash,password_salt")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find user: ${error.message}`);
  }

  return data as AdminUser | null;
}

export async function countAdminUsers() {
  const { count, error } = await getSupabaseAdmin()
    .from("admin_users")
    .select("id", { count: "exact", head: true });

  if (error) {
    throw new Error(`Failed to count users: ${error.message}`);
  }

  return count ?? 0;
}

export async function createAdminUser(input: { email: string; password: string }) {
  const password = await hashPassword(input.password);
  const { data, error } = await getSupabaseAdmin()
    .from("admin_users")
    .insert({
      email: input.email.toLowerCase(),
      password_hash: password.hash,
      password_salt: password.salt
    })
    .select("id,email,password_hash,password_salt")
    .single();

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  return data as AdminUser;
}

export async function verifyAdminUserPassword(input: { email: string; password: string }) {
  const user = await findAdminUserByEmail(input.email);

  if (!user) {
    return null;
  }

  const valid = await verifyPassword({
    password: input.password,
    hash: user.password_hash,
    salt: user.password_salt
  });

  return valid ? user : null;
}

export async function ensureBootstrapAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  const userCount = await countAdminUsers();

  if (userCount > 0) {
    return null;
  }

  return createAdminUser({ email, password });
}
