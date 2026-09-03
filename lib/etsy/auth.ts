import { cookies } from "next/headers";
import { getRequiredEnv } from "@/lib/config/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const ETSY_OAUTH_COOKIE = "etsy_oauth_pkce";
const ETSY_TOKEN_SETTING = "etsy_oauth_token";
const ETSY_SHOP_ID_SETTING = "etsy_shop_id";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_API_URL = "https://api.etsy.com/v3/application";

type EtsyOAuthCookie = {
  state: string;
  codeVerifier: string;
};

type EtsyStoredToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
};

type EtsyTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

function base64UrlEncode(bytes: Uint8Array) {
  return Buffer.from(bytes)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function getEtsyKeystring() {
  return getRequiredEnv("ETSY_API_KEY").split(":")[0];
}

function getRedirectUri(request: Request) {
  const etsyRedirectUri = process.env.ETSY_REDIRECT_URI;

  if (etsyRedirectUri) {
    return etsyRedirectUri;
  }

  return `${new URL(request.url).origin}/api/auth/etsy/callback`;
}

async function createCodeChallenge(codeVerifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );

  return base64UrlEncode(new Uint8Array(digest));
}

export async function createEtsyAuthorizationUrl(request: Request) {
  const state = randomBase64Url();
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const cookieStore = await cookies();

  cookieStore.set(
    ETSY_OAUTH_COOKIE,
    Buffer.from(JSON.stringify({ state, codeVerifier })).toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60
    }
  );

  const url = new URL("https://www.etsy.com/oauth/connect");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", getEtsyKeystring());
  url.searchParams.set("redirect_uri", getRedirectUri(request));
  url.searchParams.set("scope", "listings_r shops_r");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url;
}

async function readOauthCookie() {
  const cookieStore = await cookies();
  const value = cookieStore.get(ETSY_OAUTH_COOKIE)?.value;

  if (!value) {
    throw new Error("Missing Etsy OAuth session cookie.");
  }

  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EtsyOAuthCookie;
}

async function saveToken(token: EtsyTokenResponse) {
  const expiresAt = Date.now() + token.expires_in * 1000 - 60_000;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: ETSY_TOKEN_SETTING,
      value: {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: expiresAt,
        scope: token.scope,
        token_type: token.token_type
      }
    },
    {
      onConflict: "key"
    }
  );

  if (error) {
    throw new Error(`Failed to save Etsy OAuth token: ${error.message}`);
  }
}

async function saveShopId(shopId: number) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: ETSY_SHOP_ID_SETTING,
      value: shopId
    },
    {
      onConflict: "key"
    }
  );

  if (error) {
    throw new Error(`Failed to save Etsy shop id: ${error.message}`);
  }
}

async function readStoredToken() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ETSY_TOKEN_SETTING)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read Etsy OAuth token: ${error.message}`);
  }

  return data?.value as EtsyStoredToken | undefined;
}

async function exchangeToken(params: URLSearchParams) {
  const response = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params,
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Etsy OAuth token exchange failed: ${response.status} ${body}`);
  }

  return (await response.json()) as EtsyTokenResponse;
}

export async function handleEtsyOAuthCallback(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(url.searchParams.get("error_description") ?? error);
  }

  if (!code || !state) {
    throw new Error("Missing Etsy OAuth code or state.");
  }

  const oauthCookie = await readOauthCookie();

  if (state !== oauthCookie.state) {
    throw new Error("Invalid Etsy OAuth state.");
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getEtsyKeystring(),
    redirect_uri: getRedirectUri(request),
    code,
    code_verifier: oauthCookie.codeVerifier
  });
  const token = await exchangeToken(params);
  await saveToken(token);
  await discoverAndSaveShopId(token.access_token);

  const cookieStore = await cookies();
  cookieStore.delete(ETSY_OAUTH_COOKIE);
}

async function etsyAuthorizedRequest<T>(path: string, accessToken: string) {
  const response = await fetch(`${ETSY_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": getRequiredEnv("ETSY_API_KEY")
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Etsy authorized request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

async function discoverAndSaveShopId(accessToken: string) {
  const me = await etsyAuthorizedRequest<{ user_id: number }>("/users/me", accessToken);
  const shop = await etsyAuthorizedRequest<{ shop_id: number }>(
    `/users/${me.user_id}/shops`,
    accessToken
  );

  await saveShopId(shop.shop_id);
}

export async function getEtsyAccessToken() {
  if (process.env.ETSY_ACCESS_TOKEN) {
    return process.env.ETSY_ACCESS_TOKEN;
  }

  const storedToken = await readStoredToken();

  if (!storedToken) {
    throw new Error("Missing Etsy OAuth token. Visit /api/auth/etsy/start as an admin.");
  }

  if (storedToken.expires_at > Date.now()) {
    return storedToken.access_token;
  }

  const token = await exchangeToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: getEtsyKeystring(),
      refresh_token: storedToken.refresh_token
    })
  );
  await saveToken(token);

  return token.access_token;
}

export async function getEtsyShopId() {
  if (process.env.ETSY_SHOP_ID) {
    return process.env.ETSY_SHOP_ID;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", ETSY_SHOP_ID_SETTING)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read Etsy shop id: ${error.message}`);
  }

  if (typeof data?.value !== "number" && typeof data?.value !== "string") {
    throw new Error("Missing Etsy shop id. Complete Etsy OAuth or set ETSY_SHOP_ID.");
  }

  return String(data.value);
}
