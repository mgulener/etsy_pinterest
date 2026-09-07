import assert from "node:assert/strict";
import test from "node:test";
import { createDurableInstagramPublisher, InstagramVerificationRequired, type PublishAttempt, type PublishAttemptStore, type DurableInstagramApi } from "../lib/instagram/durablePublishing";
import type { CreateInstagramPostInput } from "../lib/instagram/types";

const input: CreateInstagramPostInput = { imageUrl: "https://example.com/a.jpg", caption: "Original caption", mode: "single" };
class Store implements PublishAttemptStore {
  row: PublishAttempt | null = null;
  saved: PublishAttempt[] = [];
  failReceipt: "before" | "after" | null = null;
  failReady = false;
  async findActive() { return this.row && !["failed", "retired"].includes(this.row.state) ? { ...this.row } : null; }
  async acquire(listingId: number, accountId: string, data: CreateInstagramPostInput) {
    if (this.row && !["failed", "retired"].includes(this.row.state)) return { attempt: { ...this.row }, created: false };
    this.row = { id: String(this.saved.length + 1), etsy_listing_id: listingId, account_id: accountId, caption: data.caption, state: "preparing", container_id: null, media_id: null, media_type: "IMAGE", created_at: new Date().toISOString() };
    this.saved.push(this.row);
    return { attempt: { ...this.row }, created: true };
  }
  async ready(id: string, container: string) {
    if (this.failReady) throw new Error("DB unavailable");
    assert.equal(this.row?.id, id); assert.equal(this.row?.state, "preparing");
    Object.assign(this.row!, { state: "ready", container_id: container });
  }
  async beginPublish(id: string) {
    if (this.row?.id !== id || this.row.state !== "ready") return false;
    this.row.state = "publishing"; return true;
  }
  async published(id: string, media: string) {
    assert.equal(this.row?.id, id);
    if (this.failReceipt === "before") throw new Error("Receipt write failed");
    Object.assign(this.row!, { state: "published", media_id: media });
    if (this.failReceipt === "after") throw new Error("Receipt response lost");
  }
  async failPreparation(id: string) {
    if (this.row?.id !== id || !["preparing", "ready"].includes(this.row.state)) return false;
    this.row.state = "failed"; return true;
  }
}
function setup() {
  const store = new Store(); const calls = { prepare: 0, publish: 0, status: 0 };
  const api: DurableInstagramApi = {
    prepare: async () => { calls.prepare++; return "container-1"; },
    wait: async () => {},
    publish: async () => { assert.equal(store.row?.state, "publishing"); calls.publish++; return { id: "media-1" }; },
    status: async () => { calls.status++; return { status_code: "PUBLISHED" }; },
    media: async () => ({ permalink: "https://instagram.com/p/test/" })
  };
  const publisher = createDurableInstagramPublisher(store, api, "account-1");
  return { store, api, calls, publisher };
}

test("container and publish intent are durable before Meta publish", async () => {
  const { publisher, store, calls } = setup();
  assert.equal((await publisher.create(1, input)).id, "media-1");
  assert.equal(store.row?.container_id, "container-1");
  assert.equal(store.row?.state, "published"); assert.equal(calls.publish, 1);
});

test("Meta success with lost response never sends a second publish", async () => {
  const { api, publisher, calls, store } = setup();
  api.publish = async () => { calls.publish++; throw new Error("Socket closed after Meta accepted publish"); };
  await assert.rejects(publisher.create(1, input), InstagramVerificationRequired);
  assert.equal(store.row?.state, "publishing");
  await assert.rejects(publisher.create(1, input), /PUBLISHED/);
  assert.equal(calls.publish, 1); assert.equal(calls.prepare, 1); assert.equal(calls.status, 1);
});

test("receipt DB failure after Meta publish blocks automatic retry", async () => {
  const { publisher, calls, store } = setup(); store.failReceipt = "before";
  await assert.rejects(publisher.create(1, input), InstagramVerificationRequired);
  store.failReceipt = null;
  await assert.rejects(publisher.create(1, input), InstagramVerificationRequired);
  assert.equal(calls.publish, 1);
});

test("saved receipt survives a lost DB response and reconciles without publish", async () => {
  const { publisher, calls, store } = setup(); store.failReceipt = "after";
  await assert.rejects(publisher.create(1, input), InstagramVerificationRequired);
  assert.equal((await publisher.reconcile(1)).id, "media-1");
  assert.equal(calls.publish, 1);
});

test("crash after durable publishing intent never causes a second request even if FINISHED", async () => {
  const { publisher, calls, store, api } = setup();
  await store.acquire(1, "account-1", input); await store.ready("1", "container-1"); await store.beginPublish("1");
  api.status = async () => ({ status_code: "FINISHED" });
  await assert.rejects(publisher.create(1, input), InstagramVerificationRequired);
  assert.equal(calls.publish, 0); assert.equal(calls.prepare, 0);
});

test("simultaneous workers resuming a ready container publish at most once", async () => {
  const { publisher, calls, store } = setup();
  await store.acquire(1, "account-1", input); await store.ready("1", "container-1");
  const results = await Promise.allSettled([publisher.create(1, input), publisher.create(1, input)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(calls.publish, 1); assert.equal(calls.prepare, 0);
});

test("container persistence failure prevents media_publish", async () => {
  const { publisher, calls, store } = setup(); store.failReady = true;
  await assert.rejects(publisher.create(1, input), /DB unavailable/);
  assert.equal(calls.publish, 0); assert.equal(store.row?.state, "failed");
});

test("safe preparation errors allow a fresh attempt", async () => {
  const { publisher, calls, api } = setup();
  api.prepare = async () => { throw new Error("Image unavailable"); };
  await assert.rejects(publisher.create(1, input), /Image unavailable/);
  api.prepare = async () => "container-2";
  assert.equal((await publisher.create(1, input)).id, "media-1"); assert.equal(calls.publish, 1);
});

test("recovery uses saved caption and media, not later queue edits", async () => {
  const { publisher, calls } = setup(); await publisher.create(1, input);
  const result = await publisher.create(1, { ...input, caption: "Changed later" });
  assert.equal(result.caption, "Original caption"); assert.equal(calls.publish, 1);
});

test("failed status lookup and missing attempt require review without creating media", async () => {
  const { publisher, api, store, calls } = setup();
  await assert.rejects(publisher.reconcile(1), InstagramVerificationRequired);
  await store.acquire(1, "account-1", input); await store.ready("1", "container-1"); await store.beginPublish("1");
  api.status = async () => { throw new Error("Meta unavailable"); };
  await assert.rejects(publisher.reconcile(1), InstagramVerificationRequired);
  assert.equal(calls.publish, 0); assert.equal(calls.prepare, 0);
});
