import assert from "node:assert/strict";
import test from "node:test";
import { getPinterestTriggerDecision, isSuccessfulSinglePinRun, publishPinWithReceipt, sendOnePinterestRun, type TriggerState } from "../scripts/trigger-pinterest-publish";

const now = Date.parse("2026-09-14T14:00:00Z");
const state: TriggerState = {
  enabled: true, environment: "production", dryRun: false, maxPins: 1, blocked: false,
  latestPublishedAt: null, publishedLastDay: 0, dueListingId: 123
};
const success = { mode: "publish", dryRun: false, selected: 1, claimed: 1,
  published: 1, skippedDuplicates: 0, failed: 0, retried: 0, errors: [] };

test("Pinterest trigger gates publication by settings, unresolved errors, time and daily count", () => {
  assert.equal(getPinterestTriggerDecision(state, now), "publish");
  assert.equal(getPinterestTriggerDecision({ ...state, enabled: false }, now), "disabled");
  for (const change of [{ environment: "sandbox" }, { dryRun: true }, { maxPins: 3 }, { blocked: true },
    { latestPublishedAt: "invalid" }, { publishedLastDay: NaN }]) {
    assert.equal(getPinterestTriggerDecision({ ...state, ...change }, now), "pause");
  }
  assert.equal(getPinterestTriggerDecision({ ...state, latestPublishedAt: new Date(now - 599_999).toISOString() }, now), "too_soon");
  assert.equal(getPinterestTriggerDecision({ ...state, latestPublishedAt: new Date(now - 600_000).toISOString() }, now), "publish");
  assert.equal(getPinterestTriggerDecision({ ...state, publishedLastDay: 144 }, now), "daily_limit");
  assert.equal(getPinterestTriggerDecision({ ...state, publishedLastDay: 143 }, now), "publish");
  assert.equal(getPinterestTriggerDecision({ ...state, dueListingId: null }, now), "empty");
});

test("Pinterest scheduled response validation rejects partial, retry, bulk and contradictory results", () => {
  assert.equal(isSuccessfulSinglePinRun(success), true);
  assert.equal(isSuccessfulSinglePinRun({ ...success, selected: 0, claimed: 0, published: 0 }), true);
  assert.equal(isSuccessfulSinglePinRun({ ...success, published: 0, skippedDuplicates: 1 }), true);
  for (const value of [null, {}, { ...success, errors: [{}] }, { ...success, dryRun: true },
    { ...success, selected: 3 }, { ...success, claimed: 0 }, { ...success, published: 0 },
    { ...success, retried: 1 }, { ...success, failed: 1 }, { ...success, pausedReason: "blocked" }]) {
    assert.equal(isSuccessfulSinglePinRun(value), false);
  }
});

test("Pinterest scheduled trigger verifies successful publications before acknowledging them", async () => {
  let verifications = 0;
  let pauses = 0;
  const result = await sendOnePinterestRun({ send: async () => success,
    verify: async () => { verifications++; return true; }, pause: async () => { pauses++; } });
  assert.equal(result.published, 1);
  assert.equal(verifications, 1);
  assert.equal(pauses, 0);
});

test("Pinterest trigger pauses on rate limits, lost responses, database errors and missing receipts without retry", async () => {
  for (const failure of ["rate", "network", "receipt", "db"]) {
    let sends = 0;
    let pauses = 0;
    await assert.rejects(sendOnePinterestRun({
      send: async () => { sends++; if (failure === "network") throw new Error("timeout");
        return failure === "rate" ? { ...success, published: 0, retried: 1, errors: [{ message: "429" }] } : success; },
      verify: async () => { if (failure === "db") throw new Error("db unavailable"); return false; },
      pause: async () => { pauses++; }
    }));
    assert.equal(sends, 1);
    assert.equal(pauses, 1);
  }
});

test("Pinterest records the provider receipt before acknowledging success and never resends", async () => {
  const events: string[] = [];
  const pin = await publishPinWithReceipt({
    send: async () => { events.push("send"); return { id: "123" }; },
    saveReceipt: async value => { assert.equal(value.id, "123"); events.push("receipt"); }
  });
  events.push("acknowledge");
  assert.equal(pin.id, "123");
  assert.deepEqual(events, ["send", "receipt", "acknowledge"]);
  for (const failure of ["missing_id", "receipt", "network"]) {
    let sends = 0;
    await assert.rejects(publishPinWithReceipt({
      send: async () => { sends++; if (failure === "network") throw new Error("timeout"); return { id: failure === "missing_id" ? "" : "123" }; },
      saveReceipt: async () => { throw new Error("disk full"); }
    }));
    assert.equal(sends, 1);
  }
});
