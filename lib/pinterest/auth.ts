import { cookies } from "next/headers";
import { getCurrentSession, requireAdminSession } from "@/lib/auth/session";
import {
  getCurrentUserSettings,
  getSettingsForUser,
  requireSetting,
  savePinterestTokenForUser
} from "@/lib/repositories/userSettingsRepository";

const PINTEREST_OAUTH_COOKIE = "pinterest_oauth_state";
const PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token";
export const PINTEREST_OAUTH_SCOPES = [
  "boards:read",
  "boards:write",
  "pins:read",
  "pins:write"
];

type PinterestOAuthCookie = {
  state: string;
  userId: string;
};

type PinterestTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
};

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export function buildPinterestAuthorizationUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("https://www.pinterest.com/oauth/");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PINTEREST_OAUTH_SCOPES.join(","));
  url.searchParams.set("state", input.state);
  return url;
}

export function shouldRefreshPinterestToken(expiresAt: number | null, now = Date.now()) {
  return expiresAt !== null && expiresAt <= now;
}

async function getRedirectUri(request: Request, userId: string) {
  const settings = await getSettingsForUser(userId);
  return settings.pinterestRedirectUri || `${new URL(request.url).origin}/api/auth/pinterest/callback`;
}

export async function createPinterestAuthorizationUrl(request: Request) {
  const session = await requireAdminSession();
  const settings = await getSettingsForUser(session.userId);
  const state = randomBase64Url();
  const cookieStore = await cookies();

  cookieStore.set(
    PINTEREST_OAUTH_COOKIE,
    Buffer.from(JSON.stringify({ state, userId: session.userId })).toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60
    }
  );

  return buildPinterestAuthorizationUrl({
    appId: requireSetting(settings.pinterestAppId, "Pinterest App ID"),
    redirectUri: await getRedirectUri(request, session.userId),
    state
  });
}

async function readOAuthCookie() {
  const value = (await cookies()).get(PINTEREST_OAUTH_COOKIE)?.value;

  if (!value) {
    throw new Error("Missing Pinterest OAuth session cookie.");
  }

  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as PinterestOAuthCookie;
}

async function exchangeToken(input: {
  appId: string;
  appSecret: string;
  params: URLSearchParams;
}) {
  const basicCredentials = Buffer.from(`${input.appId}:${input.appSecret}`).toString("base64");
  const response = await fetch(PINTEREST_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicCredentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: input.params,
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinterest OAuth token exchange failed: ${response.status} ${body}`);
  }

  return (await response.json()) as PinterestTokenResponse;
}

async function saveToken(userId: string, token: PinterestTokenResponse, previousRefreshToken?: string | null) {
  const refreshToken = token.refresh_token ?? previousRefreshToken;

  if (!refreshToken) {
    throw new Error("Pinterest OAuth response did not include a refresh token.");
  }

  await savePinterestTokenForUser({
    userId,
    accessToken: token.access_token,
    refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000 - 5 * 60_000,
    scope: token.scope,
    tokenType: token.token_type
  });
}

export async function handlePinterestOAuthCallback(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(url.searchParams.get("error_description") ?? error);
  }

  if (!code || !state) {
    throw new Error("Missing Pinterest OAuth code or state.");
  }

  const oauthCookie = await readOAuthCookie();

  if (state !== oauthCookie.state) {
    throw new Error("Invalid Pinterest OAuth state.");
  }

  const settings = await getSettingsForUser(oauthCookie.userId);
  const token = await exchangeToken({
    appId: requireSetting(settings.pinterestAppId, "Pinterest App ID"),
    appSecret: requireSetting(settings.pinterestAppSecret, "Pinterest App secret"),
    params: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: await getRedirectUri(request, oauthCookie.userId)
    })
  });

  await saveToken(oauthCookie.userId, token);
  (await cookies()).delete(PINTEREST_OAUTH_COOKIE);
}

export async function getPinterestAccessToken(userId?: string | null) {
  const session = userId ? null : await getCurrentSession();
  const resolvedUserId = userId ?? session?.userId;
  const settings = resolvedUserId
    ? await getSettingsForUser(resolvedUserId)
    : await getCurrentUserSettings();

  if (!settings.pinterestAccessToken) {
    throw new Error("Missing Pinterest OAuth token. Connect Pinterest from Settings.");
  }

  if (
    !settings.pinterestRefreshToken ||
    !shouldRefreshPinterestToken(settings.pinterestTokenExpiresAt)
  ) {
    return settings.pinterestAccessToken;
  }

  const token = await exchangeToken({
    appId: requireSetting(settings.pinterestAppId, "Pinterest App ID"),
    appSecret: requireSetting(settings.pinterestAppSecret, "Pinterest App secret"),
    params: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: settings.pinterestRefreshToken
    })
  });

  if (!resolvedUserId) {
    throw new Error("Pinterest token cannot be refreshed without an automation user.");
  }

  await saveToken(resolvedUserId, token, settings.pinterestRefreshToken);
  return token.access_token;
}
