import { timingSafeEqual } from "crypto";

const ITERATIONS = 210_000;
const KEY_LENGTH = 32;
const HASH_ALGORITHM = "SHA-256";

function base64UrlEncode(input: ArrayBuffer | Uint8Array) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

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

  return Buffer.from(padded, "base64");
}

export async function hashPassword(password: string, salt = crypto.randomUUID()) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: HASH_ALGORITHM,
      salt: new TextEncoder().encode(salt),
      iterations: ITERATIONS
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  return {
    salt,
    hash: base64UrlEncode(bits)
  };
}

export async function verifyPassword(input: {
  password: string;
  hash: string;
  salt: string;
}) {
  const expected = base64UrlDecode(input.hash);
  const actual = base64UrlDecode((await hashPassword(input.password, input.salt)).hash);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
