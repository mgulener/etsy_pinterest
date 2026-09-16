import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/types";
import { createSeasonalPlanningRepository } from "../lib/repositories/seasonalPlanningRepository";
import { createPinQueueRepository } from "../lib/repositories/pinQueueRepository";
import { createInstagramQueueRepository } from "../lib/repositories/instagramQueueRepository";
import { CLASSIFIER_VERSION, eventInputHash, type EventClassification } from "../lib/queue/eventClassification";

const product = { etsyListingId: 42, title: "Halloween shirt", description: "Halloween design", tags: [] };
const classification: EventClassification = { kind: "event", events: ["halloween"], confidence: "high", evidence: ["Halloween"], reason: "Named occasion", targetYear: null };
const cachedRow = { user_id: "owner", etsy_listing_id: 42, input_hash: eventInputHash(product), classifier_version: CLASSIFIER_VERSION, model: "test-model", classification };

test("seasonal cache is scoped per user, rejects stale inputs and persists normalized classifications", async () => {
  let requests = 0;
  const db = createClient<Database>("https://cache.test", "test", { global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    requests++;
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.user_id, "owner");
      assert.equal(body.etsy_listing_id, 42);
      assert.equal(body.input_hash, eventInputHash(product));
      assert.deepEqual(body.classification, classification);
      return new Response(null, { status: 201 });
    }
    assert.equal(url.searchParams.get("user_id"), "eq.owner");
    if (url.pathname.endsWith("seasonal_planning_settings")) return Response.json(null);
    assert.equal(url.searchParams.get("etsy_listing_id"), "in.(42)");
    return Response.json([cachedRow]);
  } }, auth: { persistSession: false } });
  const repo = createSeasonalPlanningRepository("owner", db);
  assert.equal((await repo.policy()).enabled, false);
  assert.equal((await repo.cached([product])).get(42)?.classification.kind, "event");
  assert.equal((await repo.cached([{ ...product, title: "Changed title" }])).size, 0);
  await repo.save(product, { inputHash: cachedRow.input_hash, version: CLASSIFIER_VERSION, model: "test-model", classification });
  assert.equal(requests, 4);
});

test("both queue adapters protect rows claimed or manually edited while a seasonal plan is being saved", async () => {
  const previousEnv = { ...process.env };
  const previousFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://queue.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.AUTOMATION_USER_ID = "owner";
  const version = "2026-09-01T12:00:00Z";
  const row = (id: string, extra = {}) => ({ id, etsy_listing_id: 42, title: product.title, description: product.description,
    created_at: version, updated_at: version, scheduled_at: version, status: "pending", schedule_locked: false, ...extra });
  const patched: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("seasonal_planning_settings")) {
      assert.equal(url.searchParams.get("user_id"), "eq.owner");
      return Response.json({ enabled: true, lead_time_days: 14, lookahead_days: 90 });
    }
    if (url.pathname.endsWith("user_settings")) return Response.json({ user_id: "owner", openai_model: "test-model" });
    if (url.pathname.endsWith("listing_event_classifications")) return Response.json([cachedRow]);
    if (url.pathname.endsWith("etsy_listings")) return Response.json([{ etsy_listing_id: 42, title: product.title, description: product.description, tags: [] }]);
    assert.ok(["/rest/v1/pin_queue", "/rest/v1/instagram_queue"].includes(url.pathname));
    if (init?.method !== "PATCH") {
      assert.equal(url.searchParams.get("status"), "in.(pending,processing)");
      return Response.json([row("editable"), row("raced"), row("manual", { schedule_locked: true }), row("claimed", { status: "processing" })]);
    }
    assert.equal(url.searchParams.get("status"), "eq.pending");
    assert.equal(url.searchParams.get("schedule_locked"), "eq.false");
    assert.equal(url.searchParams.get("updated_at"), `eq.${version}`);
    const id = url.searchParams.get("id")!.slice(3);
    assert.ok(["editable", "raced"].includes(id));
    const body = JSON.parse(String(init.body));
    assert.deepEqual(Object.keys(body).sort(), ["schedule_locked", "scheduled_at"]);
    assert.ok(Date.parse(body.scheduled_at) >= Date.now() - 1000);
    patched.push(`${url.pathname}:${id}`);
    // PostgREST returns no row when a publisher/manual edit wins the version race.
    return Response.json(id === "editable" ? [{ id }] : []);
  };
  try {
    assert.equal(await createPinQueueRepository().rebuildPendingSchedule(), 1);
    assert.equal(await createInstagramQueueRepository().rebuildPendingSchedule(), 1);
    assert.equal(patched.length, 4);
  } finally {
    globalThis.fetch = previousFetch;
    process.env = previousEnv;
  }
});
