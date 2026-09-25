import assert from "node:assert/strict";
import test from "node:test";
import { createFacebookPhoto, verifyFacebookPage } from "../lib/facebook/client";
import { buildFacebookMessage, facebookPermalink, validateFacebookMedia, validateFacebookMessage } from "../lib/facebook/content";
import { FacebookError, FacebookTokenError, type FacebookQueueRow, type FacebookSettings } from "../lib/facebook/types";
import { publishFacebookWithDependencies, type FacebookPublishDependencies } from "../lib/services/publishFacebookPosts";
import { syncEtsyListingsWithDependencies } from "../lib/services/syncEtsyListings";

const settings: FacebookSettings = {
  user_id: "owner", page_id: "123", page_name: "Test Page", page_access_token: "private-token",
  api_version: "v24.0", enabled: true, automatic_enabled: true, interval_minutes: 15,
  verified_at: "2026-09-15T08:00:00Z", updated_at: "2026-09-15T08:00:00Z"
};
const item: FacebookQueueRow = {
  id: "item", user_id: "owner", page_id: "123", etsy_listing_id: 456, title: "Halloween Shirt",
  image_url: "https://i.etsystatic.com/image.jpg", destination_url: "https://www.etsy.com/listing/456/shirt",
  message: "A Halloween design.", status: "processing", scheduled_at: "2026-09-15T08:00:00Z",
  schedule_locked: false, attempt_count: 1, last_error: null, request_started_at: "2026-09-15T08:00:00Z",
  facebook_post_id: null, published_at: null, created_at: "2026-09-15T08:00:00Z", updated_at: "2026-09-15T08:00:00Z"
};

function harness() {
  const calls: string[] = [];
  const deps: FacebookPublishDependencies = {
    settings, automatic: false, dryRun: false,
    queue: {
      async preview() { calls.push("preview"); return item; },
      async claim() { calls.push("claim"); return item; },
      async recordPublished(_id, postId) { calls.push(`receipt:${postId}`); return item; },
      async recordFailure(_id, _message, ambiguous) { calls.push(ambiguous ? "review" : "failed"); return item; },
      async pause() { calls.push("pause"); }
    },
    async publish() { calls.push("publish"); return { postId: "123_789" }; }
  };
  return { calls, deps };
}

test("Facebook disabled and automatic opt-out do not claim or call Meta", async () => {
  for (const config of [null, { ...settings, enabled: false }, { ...settings, automatic_enabled: false }]) {
    const { calls, deps } = harness();
    deps.settings = config; deps.automatic = true;
    assert.equal((await publishFacebookWithDependencies(deps)).status, "disabled");
    assert.deepEqual(calls, []);
  }
});

test("Facebook dry run and empty/busy claim never publish", async () => {
  const { calls, deps } = harness(); deps.dryRun = true;
  assert.deepEqual(await publishFacebookWithDependencies(deps), { status: "dry_run", selected: 1 });
  assert.deepEqual(calls, ["preview"]);
  deps.dryRun = false; deps.queue.claim = async () => null;
  assert.equal((await publishFacebookWithDependencies(deps)).status, "waiting");
  assert.deepEqual(calls, ["preview"]);
});

test("Facebook persists its exact receipt once after one provider call", async () => {
  const { calls, deps } = harness();
  assert.deepEqual(await publishFacebookWithDependencies(deps), { status: "published", postId: "123_789" });
  assert.deepEqual(calls, ["claim", "publish", "receipt:123_789"]);
});

test("Facebook ambiguous response and receipt failure pause and never retry", async () => {
  for (const failure of ["network", "receipt", "db_after_receipt"]) {
    const { calls, deps } = harness();
    if (failure === "network") deps.publish = async () => { calls.push("publish"); throw new FacebookError("Lost response", true, true); };
    else deps.queue.recordPublished = async () => { throw new Error("Database unavailable"); };
    if (failure === "db_after_receipt") deps.queue.recordFailure = async () => { throw new Error("Database still unavailable"); };
    if (failure === "db_after_receipt") await assert.rejects(publishFacebookWithDependencies(deps));
    else assert.equal((await publishFacebookWithDependencies(deps)).status, "needs_review");
    assert.equal(calls.filter(call => call === "publish").length, 1);
    assert.equal(calls.at(-1), "pause");
  }
});

test("Facebook known rejection is failed, not ambiguous; expired token pauses", async () => {
  const { calls, deps } = harness();
  deps.publish = async () => { throw new FacebookError("Expired token", false, true); };
  assert.equal((await publishFacebookWithDependencies(deps)).status, "failed");
  assert.deepEqual(calls, ["claim", "failed", "pause"]);
});

test("Facebook automatic runs pause on every known rejection without retry", async () => {
  const { calls, deps } = harness(); deps.automatic = true;
  deps.publish = async () => { calls.push("publish"); throw new FacebookError("Rejected"); };
  assert.equal((await publishFacebookWithDependencies(deps)).status, "failed");
  assert.deepEqual(calls, ["claim", "publish", "failed", "pause"]);
});

test("Facebook refuses cross-user and changed-Page claims before publication", async () => {
  for (const changed of [{ user_id: "other" }, { page_id: "999" }]) {
    const { calls, deps } = harness();
    deps.queue.claim = async () => ({ ...item, ...changed });
    assert.equal((await publishFacebookWithDependencies(deps)).status, "needs_review");
    assert.deepEqual(calls, ["review", "pause"]);
  }
});

test("Facebook sends one photo, approved message and Etsy link; credentials stay in headers", async () => {
  let calls = 0;
  const result = await createFacebookPhoto(settings, { message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url }, async (url, options) => {
    calls++;
    assert.equal(url, "https://graph.facebook.com/v24.0/123/photos");
    assert.equal(options?.method, "POST");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer private-token");
    const body = options?.body as URLSearchParams;
    assert.equal(body.get("url"), item.image_url);
    assert.equal(body.get("message"), `${item.message}\n\n${item.destination_url}`);
    assert.equal(body.get("published"), "true");
    assert.equal(body.has("access_token"), false);
    return Response.json({ id: "photo-789", post_id: "123_789" });
  });
  assert.equal(calls, 1); assert.equal(result.postId, "123_789");
});

test("Facebook malformed success, HTTP 5xx and network failure are ambiguous", async () => {
  for (const fetcher of [
    async () => Response.json({ id: "photo-only" }),
    async () => Response.json({ error: { code: 2 } }, { status: 503 }),
    async () => { throw new Error("timeout private-token"); }
  ]) {
    await assert.rejects(createFacebookPhoto(settings, { message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url }, fetcher),
      error => error instanceof FacebookError && error.ambiguous && !error.message.includes("private-token"));
  }
});

test("Facebook Graph errors never expose provider-echoed secrets", async () => {
  await assert.rejects(createFacebookPhoto(settings, { message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url }, async () =>
    Response.json({ error: { code: 190, message: "private-token" } }, { status: 400 })),
  error => error instanceof FacebookError && !error.ambiguous && error.pause && !error.message.includes("private-token"));
});

test("Facebook identity checkpoint is actionable, pauses publishing and stays secret-free", async () => {
  await assert.rejects(createFacebookPhoto(settings, {
    message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url
  }, async () => Response.json({
    error: { code: 368, error_subcode: 4854002, message: "private-token" }
  }, { status: 400 })), error => error instanceof FacebookError && !error.ambiguous && error.pause &&
    error.message.includes("identity confirmation") && !error.message.includes("private-token"));
});

test("Facebook generic restriction reports safe diagnostic codes and pauses publishing", async () => {
  await assert.rejects(createFacebookPhoto(settings, {
    message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url
  }, async () => Response.json({
    error: { code: 368, error_subcode: 1390008, message: "private-token" }
  }, { status: 400 })), error => error instanceof FacebookError && !error.ambiguous && error.pause &&
    error.message.includes("code 368, subcode 1390008") && !error.message.includes("private-token"));
});

test("Facebook verifies token identity and rejects mismatched Page IDs", async () => {
  assert.deepEqual(await verifyFacebookPage(settings, async () => Response.json({ id: "123", name: "Test Page" })), { id: "123", name: "Test Page" });
  await assert.rejects(verifyFacebookPage(settings, async () => Response.json({ id: "999", name: "Other Page" })), /does not match/);
});

test("Facebook expired and revoked tokens have actionable, secret-free errors", async () => {
  for (const subcode of [463, 458]) {
    await assert.rejects(verifyFacebookPage(settings, async () => Response.json({
      error: { code: 190, error_subcode: subcode, message: "private-token" }
    }, { status: 401 })), error => error instanceof FacebookTokenError && error.pause && !error.ambiguous &&
      error.message.includes(subcode === 463 ? "expired" : "invalid or revoked") && !error.message.includes("private-token"));
  }
});

test("Facebook 5xx with an auth error remains ambiguous for publication", async () => {
  await assert.rejects(createFacebookPhoto(settings, { message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url },
    async () => Response.json({ error: { code: 190 } }, { status: 503 })),
  error => error instanceof FacebookError && error.ambiguous && error.pause);
});

test("Facebook content validation preserves complete short text and rejects unsafe links", () => {
  assert.equal(buildFacebookMessage("St. Patrick&#39;s", "A complete sentence."), "St. Patrick's\n\nA complete sentence.");
  assert.throws(() => validateFacebookMessage(" "));
  assert.throws(() => validateFacebookMessage("a".repeat(2001)));
  assert.throws(() => validateFacebookMedia("http://localhost/secret", item.destination_url));
  assert.throws(() => validateFacebookMedia("https://etsystatic.com.attacker.test/image", item.destination_url));
  assert.throws(() => validateFacebookMedia(item.image_url, "javascript:alert(1)"));
  assert.equal(facebookPermalink("123_789"), "https://www.facebook.com/123_789");
  assert.equal(facebookPermalink("https://attacker.test"), null);
});

test("Facebook verification retries transport failure once without treating it as an expired token", async () => {
  let calls = 0;
  const page = await verifyFacebookPage(settings, async () => {
    if (++calls === 1) throw new TypeError("Network failure containing secret-token");
    return Response.json({ id: settings.page_id, name: "Test Page" });
  });
  assert.equal(calls, 2);
  assert.equal(page.id, settings.page_id);
  calls = 0;
  await assert.rejects(verifyFacebookPage(settings, async () => {
    calls++; throw new DOMException("secret-token", "TimeoutError");
  }), error => error instanceof FacebookError && /timeout/.test(error.message) && !/secret-token/.test(error.message));
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(verifyFacebookPage(settings, async () => {
    calls++; return Response.json({ error: { code: 190, error_subcode: 463 } }, { status: 400 });
  }));
  assert.equal(calls, 1);
});

test("Etsy sync queues Facebook once, schedules it and leaves failed inserts rediscoverable", async () => {
  for (const fail of [false, true]) {
    const saved: number[] = [];
    let queued = 0; let scheduled = 0;
    const result = await syncEtsyListingsWithDependencies({
      etsy: { async getAllActiveListings() { return [{ listing_id: 456, title: "Halloween Shirt", state: "active" }]; } },
      listingsRepository: {
        async getExistingEtsyListingIds() { return new Set(); },
        async savePendingListing() {},
        async upsertKnownListing(listing) { saved.push(listing.etsyListingId); },
        async upsertKnownListings() {}, async updateLastSeen() {}
      },
      settingsRepository: { async isInitialSyncCompleted() { return true; }, async setInitialSyncCompleted() {} },
      facebookQueueRepository: {
        async enqueueListing() { if (fail) throw new Error("DB failure"); queued++; return "created"; },
        async rebuildPendingSchedule() { scheduled++; return 1; }
      }
    });
    assert.equal(result.facebookQueued, fail ? 0 : 1);
    assert.equal(queued, fail ? 0 : 1); assert.equal(scheduled, fail ? 0 : 1);
    assert.deepEqual(saved, fail ? [] : [456]);
    assert.equal(result.errors.length, fail ? 1 : 0);
  }
});
