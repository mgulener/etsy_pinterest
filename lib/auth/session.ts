import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerEnv } from "@/lib/config/env";

const ADMIN_COOKIE = "etsy_pinterest_admin";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

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

async function sign(payload: string) {
  const env = getServerEnv();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.adminPassword),
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

async function createSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64UrlEncode(JSON.stringify({ expiresAt }));
  const signature = await sign(payload);

  return `${payload}.${signature}`;
}

export async function createAdminSession() {
  const token = await createSessionToken();
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

export async function isAdminSessionValid() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;

  if (!token) {
    return false;
  }

  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return false;
  }

  const expectedSignature = await sign(payload);

  if (signature !== expectedSignature) {
    return false;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { expiresAt?: number };
    return typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now() / 1000;
  } catch {
    return false;
  }
}

export async function requireAdminSession() {
  if (!(await isAdminSessionValid())) {
    redirect("/login");
  }
}

export async function requireAdminRequest() {
  if (!(await isAdminSessionValid())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
