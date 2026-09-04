import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRequiredEnv } from "@/lib/config/env";

const ADMIN_COOKIE = "etsy_pinterest_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AuthSession = {
  userId: string;
  email: string;
  expiresAt: number;
};

function base64UrlEncode(input: ArrayBuffer | string) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);

  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(input: string) {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );

  return Buffer.from(padded, "base64").toString("utf8");
}

function getSessionSecret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || getRequiredEnv("CRON_SECRET");
}

async function sign(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return base64UrlEncode(signature);
}

async function createSessionToken(user: { id: string; email: string }) {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64UrlEncode(JSON.stringify({ userId: user.id, email: user.email, expiresAt }));
  const signature = await sign(payload);

  return `${payload}.${signature}`;
}

export async function createAdminSession(user: { id: string; email: string }) {
  const token = await createSessionToken(user);
  const cookieStore = await cookies();

  cookieStore.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  let token: string | undefined;

  try {
    const cookieStore = await cookies();
    token = cookieStore.get(ADMIN_COOKIE)?.value;
  } catch {
    return null;
  }

  if (!token) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = await sign(payload);

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<AuthSession>;
    const valid =
      typeof parsed.userId === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now() / 1000;

    if (!valid) {
      return null;
    }

    return {
      userId: parsed.userId as string,
      email: parsed.email as string,
      expiresAt: parsed.expiresAt as number
    };
  } catch {
    return null;
  }
}

export async function isAdminSessionValid() {
  return Boolean(await getCurrentSession());
}

export async function requireAdminSession() {
  const session = await getCurrentSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireAdminRequest() {
  if (!(await isAdminSessionValid())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
