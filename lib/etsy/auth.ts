import { cookies } from "next/headers";
import { getCurrentSession, requireAdminSession } from "@/lib/auth/session";
import {
  getCurrentUserSettings,
  getSettingsForUser,
  requireSetting,
  saveEtsyShopIdForUser,
  saveEtsyTokenForUser
} from "@/lib/repositories/userSettingsRepository";

const ETSY_OAUTH_COOKIE = "etsy_oauth_pkce";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const ETSY_API_URL = "https://api.etsy.com/v3/application";

type EtsyOAuthCookie = {
  state: string;
  codeVerifier: string;
  userId: string;
};

type EtsyTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

type EtsyShopResponse = {
  shop_id?: number;
  results?: Array<{ shop_id?: number }>;
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

function getEtsyKeystringFromApiKey(apiKey: string) {
  return apiKey.split(":")[0];
}

export function extractEtsyShopId(response: EtsyShopResponse) {
  const shopId = response.shop_id ?? response.results?.[0]?.shop_id;

  if (!shopId) {
    throw new Error("Etsy shop ID was not found in the OAuth account response.");
  }

  return shopId;
}

async function getEtsyApiKeyForUser(userId?: string) {
  const settings = userId ? await getSettingsForUser(userId) : await getCurrentUserSettings();
  return requireSetting(settings.etsyApiKey, "Etsy API keystring and shared secret");
}

async function getRedirectUri(request: Request, userId?: string) {
  const settings = userId ? await getSettingsForUser(userId) : await getCurrentUserSettings();

  if (settings.etsyRedirectUri) {
    return settings.etsyRedirectUri;
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
  const session = await requireAdminSession();
  const state = randomBase64Url();
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const cookieStore = await cookies();
  const apiKey = await getEtsyApiKeyForUser(session.userId);

  cookieStore.set(
    ETSY_OAUTH_COOKIE,
    Buffer.from(JSON.stringify({ state, codeVerifier, userId: session.userId })).toString("base64url"),
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
  url.searchParams.set("client_id", getEtsyKeystringFromApiKey(apiKey));
  url.searchParams.set("redirect_uri", await getRedirectUri(request, session.userId));
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

export async function handleEtsyOAuthCallback(request: Request): Promise<{ shopIdSaved: boolean; warning?: string }> {
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

  const apiKey = await getEtsyApiKeyForUser(oauthCookie.userId);
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: getEtsyKeystringFromApiKey(apiKey),
    redirect_uri: await getRedirectUri(request, oauthCookie.userId),
    code,
    code_verifier: oauthCookie.codeVerifier
  });
  const token = await exchangeToken(params);
  await saveToken(oauthCookie.userId, token);

  let shopIdSaved = true;
  let warning: string | undefined;

  try {
    await discoverAndSaveShopId(oauthCookie.userId, token.access_token);
  } catch (error) {
    shopIdSaved = false;
    warning = error instanceof Error ? error.message : "Etsy shop ID could not be detected automatically.";
    console.error("[ETSY_OAUTH] Shop discovery failed", error);
  }

  const cookieStore = await cookies();
  cookieStore.delete(ETSY_OAUTH_COOKIE);

  return { shopIdSaved, warning };
}

async function saveToken(userId: string, token: EtsyTokenResponse) {
  const expiresAt = Date.now() + token.expires_in * 1000 - 60_000;
  await saveEtsyTokenForUser({
    userId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt,
    scope: token.scope,
    tokenType: token.token_type
  });
}

async function etsyAuthorizedRequest<T>(path: string, accessToken: string, userId?: string) {
  const apiKey = await getEtsyApiKeyForUser(userId);
  const response = await fetch(`${ETSY_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-api-key": apiKey
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Etsy authorized request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

async function discoverAndSaveShopId(userId: string, accessToken: string) {
  const me = await etsyAuthorizedRequest<{ user_id: number }>("/users/me", accessToken, userId);
  const shop = await etsyAuthorizedRequest<EtsyShopResponse>(
    `/users/${me.user_id}/shops`,
    accessToken,
    userId
  );

  await saveEtsyShopIdForUser(userId, extractEtsyShopId(shop));
}

export async function getEtsyAccessToken(userId?: string) {
  const session = userId ? null : await getCurrentSession();
  const resolvedUserId = userId ?? session?.userId;
  const settings = await getSettingsForUser(resolvedUserId);

  if (!settings.etsyAccessToken) {
    throw new Error("Missing Etsy OAuth token. Connect Etsy from Settings.");
  }

  if (!settings.etsyRefreshToken || !settings.etsyTokenExpiresAt || settings.etsyTokenExpiresAt > Date.now()) {
    return settings.etsyAccessToken;
  }

  const apiKey = requireSetting(settings.etsyApiKey, "Etsy API keystring and shared secret");
  const token = await exchangeToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: getEtsyKeystringFromApiKey(apiKey),
      refresh_token: settings.etsyRefreshToken
    })
  );

  if (resolvedUserId) {
    await saveToken(resolvedUserId, token);
  }

  return token.access_token;
}

export async function getEtsyShopId(userId?: string) {
  const session = userId ? null : await getCurrentSession();
  const settings = await getSettingsForUser(userId ?? session?.userId);

  return requireSetting(settings.etsyShopId, "Etsy shop ID");
}

export async function getEtsyApiKey(userId?: string) {
  return getEtsyApiKeyForUser(userId);
}
