import assert from "node:assert/strict";
import test from "node:test";
import { triggerFacebook, getFacebookQueueBlockState } from "../scripts/trigger-facebook-publish";
import { isValidFacebookInterval } from "../lib/facebook/settings";
import { FacebookTokenError } from "../lib/facebook/types";

function harness() {
  const calls: string[] = [];
  const state = { enabled: true, automaticEnabled: true, dryRun: false, busy: false, needsReview: false };
  const deps = {
    async inspect() { calls.push("inspect"); return state; },
    async verifyPage() { calls.push("verify"); },
    async publish() { calls.push("publish"); return { status: "published", postId: "123_456" }; },
    async verifyReceipt() { calls.push("receipt"); return true; },
    async pause() { calls.push("pause"); }
  };
  return { calls, state, deps };
}

test("Facebook interval validation accepts five minutes and rejects shorter/fractional values", () => {
  for (const value of [5, 15, 1440]) assert.equal(isValidFacebookInterval(value), true);
  for (const value of [NaN, 0, 4, 4.9, 5.5, 1441]) assert.equal(isValidFacebookInterval(value), false);
});
test("CLI defaults to read-only including blocked state; unknown arguments do nothing", async () => {
  const { deps, calls, state } = harness(); state.needsReview = true;
  assert.equal((await triggerFacebook([], deps)).status, "read_only");
  assert.deepEqual(calls, ["inspect"]);
  await assert.rejects(triggerFacebook(["--unknown"], deps));
  assert.deepEqual(calls, ["inspect"]);
});
test("CLI respects disabled and dry-run settings without any write", async () => {
  for (const key of ["enabled", "automaticEnabled", "dryRun"] as const) {
    const { deps, state, calls } = harness(); state[key] = key === "dryRun";
    assert.equal((await triggerFacebook(["--run"], deps)).status, key === "dryRun" ? "dry_run" : "disabled");
    assert.deepEqual(calls, ["inspect"]);
  }
});
test("CLI publishes once and verifies receipt", async () => {
  const { deps, calls } = harness();
  assert.equal((await triggerFacebook(["--run"], deps)).status, "published");
  assert.deepEqual(calls, ["inspect", "verify", "publish", "receipt"]);
});
test("CLI pauses on review, metadata failure, rejection and receipt uncertainty without retry", async () => {
  for (const failure of ["review", "metadata", "failed", "needs_review", "receipt"]) {
    const { deps, calls, state } = harness();
    if (failure === "review") state.needsReview = true;
    if (failure === "metadata") deps.verifyPage = async () => { throw new Error("private upstream error"); };
    if (["failed", "needs_review"].includes(failure)) deps.publish = async () => { calls.push("publish"); return { status: failure, postId: "" }; };
    if (failure === "receipt") deps.verifyReceipt = async () => false;
    try { await triggerFacebook(["--run"], deps); } catch (error) { assert.equal(String(error).includes("private"), false); }
    assert.equal(calls.at(-1), "pause");
    assert.ok(calls.filter(call => call === "publish").length <= 1);
  }
});

test("CLI treats active processing as busy without pausing and stale processing as review", async () => {
  const now = Date.parse("2026-09-15T10:00:00Z");
  assert.deepEqual(getFacebookQueueBlockState([{ status: "processing", request_started_at: new Date(now - 60_000).toISOString() }], now), { busy: true, needsReview: false });
  for (const started of [null, "invalid", new Date(now - 300_000).toISOString()]) {
    assert.equal(getFacebookQueueBlockState([{ status: "processing", request_started_at: started }], now).needsReview, true);
  }
  assert.equal(getFacebookQueueBlockState([{ status: "needs_review", request_started_at: null }], now).needsReview, true);
  const { deps, state, calls } = harness(); state.busy = true;
  assert.equal((await triggerFacebook(["--run"], deps)).status, "busy");
  assert.deepEqual(calls, ["inspect"]);
});

test("CLI normal waiting result does not pause or retry", async () => {
  const { deps, calls } = harness();
  deps.publish = async () => { calls.push("publish"); return { status: "waiting", postId: "" }; };
  assert.equal((await triggerFacebook(["--run"], deps)).status, "waiting");
  assert.deepEqual(calls, ["inspect", "verify", "publish"]);
});

test("CLI preserves safe token-expiry diagnosis, pauses and never attempts publication", async () => {
  const { deps, calls } = harness();
  deps.verifyPage = async () => { calls.push("verify"); throw new FacebookTokenError(true); };
  await assert.rejects(triggerFacebook(["--run"], deps), /token has expired/);
  assert.deepEqual(calls, ["inspect", "verify", "pause"]);
});
