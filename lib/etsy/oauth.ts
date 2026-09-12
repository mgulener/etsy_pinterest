import { createHmac, timingSafeEqual } from "node:crypto";

export const ETSY_READ_SCOPES = ["listings_r", "shops_r"] as const;
export const ETSY_WRITE_SCOPES = [...ETSY_READ_SCOPES, "listings_w"] as const;
export const ETSY_OAUTH_TTL_SECONDS = 10 * 60;

export class EtsyConsentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "EtsyConsentError";
  }
}

export type EtsyOAuthState = {
  state: string;
  codeVerifier: string;
  userId: string;
  redirectUri: string;
  requestedScopes: string;
  expiresAt: number;
};

export async function getRequestedEtsyScopes(request: Request): Promise<string> {
  if (request.method === "GET") {
    return ETSY_READ_SCOPES.join(" ");
  }

  if (request.method !== "POST") {
    throw new EtsyConsentError("Unsupported Etsy connection method.", 405);
  }

  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const originUrl = new URL(origin ?? "");
    // Next normalizes loopback URLs. Host retains the authority used by the browser.
    sameOrigin = originUrl.origin === origin &&
      originUrl.host === (request.headers.get("host") ?? requestUrl.host) &&
      originUrl.protocol === requestUrl.protocol;
  } catch {
    sameOrigin = false;
  }

  if (!sameOrigin) {
    throw new EtsyConsentError("Etsy write access must be approved from Settings.", 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new EtsyConsentError("Invalid Etsy permission approval form.");
  }

  if (
    form.getAll("permission").length !== 1 ||
    form.get("permission") !== "listing-write" ||
    form.getAll("confirmWriteAccess").length !== 1 ||
    form.get("confirmWriteAccess") !== "approved"
  ) {
    throw new EtsyConsentError("Explicit approval is required for Etsy listing write access.");
  }

  return ETSY_WRITE_SCOPES.join(" ");
}

export function hasEtsyListingWriteAccess(scope: string | null | undefined) {
  return (scope ?? "").split(/\s+/).includes("listings_w");
}

export function resolveEtsyTokenScope(returnedScope: string | undefined, previousScope: string | null) {
  // OAuth may omit an unchanged scope. Never merge old permissions into an explicit response.
  return returnedScope === undefined ? previousScope ?? undefined : returnedScope.trim();
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`etsy-oauth:${payload}`).digest();
}

export function signEtsyOAuthState(state: EtsyOAuthState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyEtsyOAuthState(input: {
  cookie: string;
  secret: string;
  userId: string | null;
  state: string;
  now?: number;
}): EtsyOAuthState {
  const [payload, encodedSignature, extra] = input.cookie.split(".");

  if (!payload || !encodedSignature || extra !== undefined) {
    throw new EtsyConsentError("Invalid Etsy OAuth session.");
  }

  const received = Buffer.from(encodedSignature, "base64url");
  const expected = signature(payload, input.secret);

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new EtsyConsentError("Invalid Etsy OAuth signature.");
  }

  let parsed: Partial<EtsyOAuthState>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new EtsyConsentError("Invalid Etsy OAuth session.");
  }

  if (
    !parsed ||
    !input.userId ||
    parsed.userId !== input.userId ||
    typeof parsed.state !== "string" ||
    parsed.state !== input.state ||
    typeof parsed.codeVerifier !== "string" ||
    parsed.codeVerifier.length < 43 ||
    typeof parsed.redirectUri !== "string" ||
    !parsed.redirectUri ||
    typeof parsed.expiresAt !== "number" ||
    !Number.isFinite(parsed.expiresAt) ||
    parsed.expiresAt <= (input.now ?? Date.now()) ||
    ![ETSY_READ_SCOPES.join(" "), ETSY_WRITE_SCOPES.join(" ")].includes(parsed.requestedScopes ?? "")
  ) {
    throw new EtsyConsentError("Etsy OAuth approval is expired or does not belong to this session.");
  }

  return parsed as EtsyOAuthState;
}

export function buildEtsyAuthorizationUrl(input: {
  apiKey: string;
  redirectUri: string;
  scopes: string;
  state: string;
  codeChallenge: string;
}) {
  const url = new URL("https://www.etsy.com/oauth/connect");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.apiKey.split(":")[0]);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}
