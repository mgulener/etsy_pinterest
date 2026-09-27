import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EtsyPermissions } from "../app/settings/EtsyPermissions";
import { getAllActiveListings, getShopSections } from "../lib/etsy/client";
import {
  buildEtsyAuthorizationUrl,
  EtsyConsentError,
  ETSY_FULL_SCOPES,
  ETSY_ORDER_READ_SCOPES,
  ETSY_READ_SCOPES,
  ETSY_WRITE_SCOPES,
  getMissingEtsyScopes,
  getRequestedEtsyScopes,
  hasEtsyListingWriteAccess,
  hasEtsyOrderReadAccess,
  resolveEtsyTokenScope,
  signEtsyOAuthState,
  verifyEtsyOAuthState,
  type EtsyOAuthState
} from "../lib/etsy/oauth";

const origin = "https://app.test";
const now = 1_800_000_000_000;
const secret = "test-only-secret-not-a-real-credential";
const approvedState: EtsyOAuthState = {
  userId: "user-one",
  state: "unpredictable-state",
  codeVerifier: "v".repeat(64),
  redirectUri: `${origin}/api/auth/etsy/callback`,
  requestedScopes: ETSY_WRITE_SCOPES.join(" "),
  expiresAt: now + 600_000
};

function consentRequest(values: Record<string, string> = {
  permission: "listing-write",
  confirmWriteAccess: "approved"
}, requestOrigin: string | null = origin) {
  return new Request(`${origin}/api/auth/etsy/start`, {
    method: "POST",
    headers: requestOrigin === null ? {} : { origin: requestOrigin },
    body: new URLSearchParams(values)
  });
}

function verify(cookie = signEtsyOAuthState(approvedState, secret), overrides = {}) {
  return verifyEtsyOAuthState({ cookie, secret, userId: approvedState.userId, state: approvedState.state, now, ...overrides });
}

test("ordinary Etsy connection remains read-only, including forged query permissions", async () => {
  for (const suffix of ["", "?permission=listing-write&confirmWriteAccess=approved&scope=listings_d"]) {
    assert.equal(await getRequestedEtsyScopes(new Request(`${origin}/api/auth/etsy/start${suffix}`)), "listings_r shops_r");
  }
});

test("listing write scope is added only with explicit same-origin POST consent", async () => {
  assert.equal(await getRequestedEtsyScopes(consentRequest()), "listings_r shops_r listings_w");
  assert.deepEqual(ETSY_READ_SCOPES, ["listings_r", "shops_r"]);
  assert.deepEqual(ETSY_WRITE_SCOPES, ["listings_r", "shops_r", "listings_w"]);
});

test("order read scope requires explicit consent and preserves an existing listing permission", async () => {
  const request = consentRequest({
    permission: "order-read",
    confirmOrderReadAccess: "approved"
  });
  assert.equal(await getRequestedEtsyScopes(request), "listings_r shops_r transactions_r");
  assert.equal(
    await getRequestedEtsyScopes(consentRequest({
      permission: "order-read",
      confirmOrderReadAccess: "approved"
    }), "listings_r shops_r listings_w"),
    "listings_r shops_r listings_w transactions_r"
  );
  assert.deepEqual(ETSY_ORDER_READ_SCOPES, ["listings_r", "shops_r", "transactions_r"]);
  assert.deepEqual(ETSY_FULL_SCOPES, ["listings_r", "shops_r", "listings_w", "transactions_r"]);
});

test("listing consent preserves previously granted order read access", async () => {
  assert.equal(
    await getRequestedEtsyScopes(consentRequest(), "listings_r shops_r transactions_r"),
    "listings_r shops_r listings_w transactions_r"
  );
});

test("missing, false, unrelated and duplicate consent values are rejected", async () => {
  const invalidForms: Array<Record<string, string>> = [
    {}, { permission: "listing-write" }, { confirmWriteAccess: "approved" },
    { permission: "listing-write", confirmWriteAccess: "false" },
    { permission: "listing-write", confirmWriteAccess: "on" },
    { permission: "delete-listings", confirmWriteAccess: "approved" },
    { permission: "order-read" },
    { permission: "order-read", confirmOrderReadAccess: "false" },
    { permission: "order-read", confirmOrderReadAccess: "on" }
  ];
  for (const values of invalidForms) {
    await assert.rejects(getRequestedEtsyScopes(consentRequest(values)), EtsyConsentError);
  }
  await assert.rejects(getRequestedEtsyScopes(new Request(`${origin}/api/auth/etsy/start`, {
    method: "POST", headers: { origin },
    body: new URLSearchParams("permission=listing-write&confirmWriteAccess=approved&confirmWriteAccess=false")
  })), EtsyConsentError);
});

test("cross-origin and missing-origin write approvals are rejected", async () => {
  for (const foreignOrigin of [null, "null", "https://attacker.test", "https://app.test.attacker.test"]) {
    await assert.rejects(getRequestedEtsyScopes(consentRequest(undefined, foreignOrigin)), (error: unknown) =>
      error instanceof EtsyConsentError && error.status === 403);
  }
});

test("same-origin approval uses the browser host when Next normalizes a loopback URL", async () => {
  const request = (requestOrigin: string) => new Request("http://localhost:3107/api/auth/etsy/start", {
    method: "POST",
    headers: { host: "127.0.0.1:3107", origin: requestOrigin },
    body: new URLSearchParams({ permission: "listing-write", confirmWriteAccess: "approved" })
  });
  assert.equal(await getRequestedEtsyScopes(request("http://127.0.0.1:3107")), "listings_r shops_r listings_w");
  for (const origin of ["http://attacker.test", "http://127.0.0.1:3108", "https://127.0.0.1:3107"]) {
    await assert.rejects(getRequestedEtsyScopes(request(origin)), EtsyConsentError);
  }
});

test("unsupported methods and malformed forms cannot authorize writes", async () => {
  await assert.rejects(getRequestedEtsyScopes(new Request(`${origin}/api/auth/etsy/start`, { method: "PUT" })), EtsyConsentError);
  await assert.rejects(getRequestedEtsyScopes(new Request(`${origin}/api/auth/etsy/start`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: '{"confirmWriteAccess":"approved"}'
  })), EtsyConsentError);
});

test("Etsy URL keeps PKCE and never exposes the shared secret", () => {
  const url = buildEtsyAuthorizationUrl({
    apiKey: "keystring:shared-secret", redirectUri: approvedState.redirectUri,
    scopes: approvedState.requestedScopes, state: approvedState.state, codeChallenge: "challenge"
  });
  assert.equal(url.origin, "https://www.etsy.com");
  assert.equal(url.pathname, "/oauth/connect");
  assert.equal(url.searchParams.get("client_id"), "keystring");
  assert.equal(url.searchParams.get("scope"), "listings_r shops_r listings_w");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "challenge");
  assert.equal(url.searchParams.get("redirect_uri"), approvedState.redirectUri);
  assert.equal(url.searchParams.get("state"), approvedState.state);
  assert.doesNotMatch(url.toString(), /shared-secret/);
});

test("signed OAuth state binds the requested permission and redirect to the initiating user", () => {
  assert.deepEqual(verify(), approvedState);
  for (const requestedScopes of [ETSY_ORDER_READ_SCOPES.join(" "), ETSY_FULL_SCOPES.join(" ")]) {
    const state = { ...approvedState, requestedScopes };
    assert.deepEqual(
      verifyEtsyOAuthState({
        cookie: signEtsyOAuthState(state, secret),
        secret,
        userId: state.userId,
        state: state.state,
        now
      }),
      state
    );
  }
});

test("OAuth callback rejects a different user, a logged-out user and incorrect state", () => {
  for (const overrides of [{ userId: "user-two" }, { userId: null }, { state: "other-state" }]) {
    assert.throws(() => verify(undefined, overrides), EtsyConsentError);
  }
});

test("OAuth callback rejects expired approvals, including the exact expiry boundary", () => {
  assert.throws(() => verify(undefined, { now: approvedState.expiresAt }), EtsyConsentError);
  assert.throws(() => verify(undefined, { now: approvedState.expiresAt + 1 }), EtsyConsentError);
});

test("OAuth state cannot be tampered to add write scope, change user or change redirect", () => {
  const signed = signEtsyOAuthState({ ...approvedState, requestedScopes: ETSY_READ_SCOPES.join(" ") }, secret);
  const signature = signed.split(".")[1];
  for (const changed of [
    approvedState,
    { ...approvedState, userId: "user-two" },
    { ...approvedState, redirectUri: "https://attacker.test/callback" }
  ]) {
    const payload = Buffer.from(JSON.stringify(changed)).toString("base64url");
    assert.throws(() => verify(`${payload}.${signature}`), EtsyConsentError);
  }
});

test("unsigned legacy cookies, malformed signatures and unknown scopes fail closed", () => {
  for (const cookie of ["", "bad.signature", Buffer.from(JSON.stringify(approvedState)).toString("base64url"), `${signEtsyOAuthState(approvedState, secret)}.extra`]) {
    assert.throws(() => verify(cookie), EtsyConsentError);
  }
  assert.throws(() => verify(undefined, { secret: "wrong-secret" }), EtsyConsentError);
  assert.throws(() => verify(signEtsyOAuthState({ ...approvedState, requestedScopes: "listings_d" }, secret)), EtsyConsentError);
});

test("scope refresh preserves unchanged scope but never silently elevates or retains removed permissions", () => {
  assert.equal(resolveEtsyTokenScope(undefined, "listings_r shops_r listings_w"), "listings_r shops_r listings_w");
  assert.equal(resolveEtsyTokenScope(undefined, "listings_r shops_r"), "listings_r shops_r");
  assert.equal(resolveEtsyTokenScope(undefined, null), undefined);
  assert.equal(resolveEtsyTokenScope("listings_r shops_r", "listings_r shops_r listings_w"), "listings_r shops_r");
  assert.equal(resolveEtsyTokenScope("", "listings_w"), "");
});

test("write access status requires an exact granted scope, not a substring or unknown scope", () => {
  for (const scope of [null, undefined, "", "listings_r shops_r", "listings_write", "not_listings_w", "listings_w_secret"]) {
    assert.equal(hasEtsyListingWriteAccess(scope), false);
  }
  assert.equal(hasEtsyListingWriteAccess("listings_r shops_r listings_w"), true);
});

test("order access status requires an exact granted scope", () => {
  for (const scope of [null, undefined, "", "transactions", "transactions_read", "not_transactions_r"]) {
    assert.equal(hasEtsyOrderReadAccess(scope), false);
  }
  assert.equal(hasEtsyOrderReadAccess("listings_r shops_r transactions_r"), true);
});

test("missing Etsy permissions are detected before a successful callback", () => {
  assert.deepEqual(
    getMissingEtsyScopes("listings_r shops_r listings_w", ETSY_FULL_SCOPES.join(" ")),
    ["transactions_r"]
  );
  assert.deepEqual(
    getMissingEtsyScopes(ETSY_FULL_SCOPES.join(" "), ETSY_FULL_SCOPES.join(" ")),
    []
  );
});

test("permission UI starts unchecked and disabled, with no automatic write form submission", () => {
  const html = renderToStaticMarkup(createElement(EtsyPermissions, {
    connected: true,
    scopeKnown: true,
    writeAccess: false,
    orderReadAccess: false,
    canConnect: true
  }));
  assert.match(html, /method="post"/);
  assert.match(html, /name="confirmWriteAccess"/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /<button[^>]*disabled=""/);
  assert.match(html, /not changes to my products/);
  assert.match(html, /Automatic Etsy sync remains read-only/);
  assert.match(html, /name="confirmOrderReadAccess"/);
  assert.match(html, /read-only access to this shop/);
  assert.doesNotMatch(html, /Connect Etsy \(read-only\)/);
});

test("Etsy listing and section retrieval issue only GET requests", async () => {
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];
  process.env.ETSY_API_KEY = "test-key:test-secret";
  process.env.ETSY_ACCESS_TOKEN = "test-token";
  process.env.ETSY_SHOP_ID = "123";
  delete process.env.ETSY_REFRESH_TOKEN;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /^https:\/\/api\.etsy\.com\/v3\/application\/shops\/123\//);
    methods.push(init?.method ?? "GET");
    return Response.json({ count: 0, results: [] });
  };
  try {
    assert.deepEqual(await getAllActiveListings(), []);
    assert.deepEqual(await getShopSections(), []);
    assert.deepEqual(methods, ["GET", "GET"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ["ETSY_API_KEY", "ETSY_ACCESS_TOKEN", "ETSY_SHOP_ID", "ETSY_REFRESH_TOKEN"]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  }
});
