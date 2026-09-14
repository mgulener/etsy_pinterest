import assert from "node:assert/strict";
import test from "node:test";
import { generatePinterestDescriptionWithAI } from "../lib/pinterest/aiDescription";
import { canEditPinDescription, getPinDescription, validatePinDescription } from "../lib/pinterest/description";
import { handlePinterestDescription, PinterestDescriptionError, type PinterestDescriptionDependencies } from "../lib/services/pinterestDescription";
import { createPinQueueRepository } from "../lib/repositories/pinQueueRepository";
import type { PinQueueRow } from "../lib/supabase/types";

const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const version = "2026-09-14T12:00:00.000Z";
const initial: PinQueueRow = {
  id, etsy_listing_id: 123, etsy_image_id: 456, image_url: "https://images.test/shirt.jpg",
  title: "Halloween Reading Shirt", description: "A ghost reading a book.",
  pin_description: null, destination_url: "https://etsy.test/listing/123", board_id: "board",
  pin_description_source: null, pin_description_generated_at: null,
  status: "pending", attempt_count: 0, last_error: null, scheduled_at: version,
  schedule_locked: false, created_at: version, updated_at: version, processed_at: null
};
const origin = "https://app.test";
const generated = "A bookish twist on Halloween with a ghost reading its favorite story. A playful design for spooky-season readers.";

function request(method = "POST", body: unknown = { expectedUpdatedAt: version }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/pinterest/queue/${id}/description`, {
    method, headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body)
  });
}

function setup(overrides: Partial<PinterestDescriptionDependencies> = {}) {
  let item = { ...initial };
  const calls = { saves: 0, generations: 0 };
  const deps: PinterestDescriptionDependencies = {
    getUserId: async () => "owner",
    getOwnerId: async () => "owner",
    findItem: async () => ({ ...item }),
    save: async (_id, description, expected) => {
      calls.saves++;
      if (item.updated_at !== expected || !canEditPinDescription(item.status)) return null;
      item = { ...item, pin_description: description, updated_at: "2026-09-14T12:01:00.000Z" };
      return { ...item };
    },
    generate: async () => { calls.generations++; return generated; },
    ...overrides
  };
  return { deps, calls, getItem: () => item };
}

test("AI preview never saves; only an explicit PATCH saves the approved draft", async () => {
  const state = setup();
  const preview = await handlePinterestDescription(request(), id, state.deps);
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), { description: generated });
  assert.equal(state.calls.saves, 0);
  assert.equal(state.getItem().pin_description, null);
  const approved = generated + " Find your next reading outfit.";
  const saved = await handlePinterestDescription(request("PATCH", { description: approved, expectedUpdatedAt: version }), id, state.deps);
  assert.equal(saved.status, 200);
  assert.equal(state.getItem().pin_description, approved);
  assert.equal(state.getItem().description, initial.description);
  assert.equal(state.calls.generations, 1);
  assert.equal(state.calls.saves, 1);
});

test("unauthenticated and other-shop users cannot read, generate or save descriptions", async () => {
  for (const [userId, status] of [[null, 401], ["other", 403]] as const) {
    for (const method of ["POST", "PATCH"]) {
      const { deps, calls } = setup({
        getUserId: async () => userId,
        findItem: async () => assert.fail("must not read another owner's queue")
      });
      assert.equal((await handlePinterestDescription(request(method), id, deps)).status, status);
      assert.deepEqual(calls, { saves: 0, generations: 0 });
    }
  }
});

test("cross-origin, missing origin, malformed input and invalid ids fail before generation or save", async () => {
  const { deps, calls } = setup();
  for (const badOrigin of ["", "null", "https://other.test", "https://app.test/", "http://app.test"]) {
    assert.equal((await handlePinterestDescription(request("POST", {}, { origin: badOrigin }), id, deps)).status, 403);
  }
  assert.equal((await handlePinterestDescription(request(), "bad-id", deps)).status, 400);
  assert.equal((await handlePinterestDescription(request("POST", {}), id, deps)).status, 400);
  assert.equal((await handlePinterestDescription(request("POST", null), id, deps)).status, 400);
  assert.equal((await handlePinterestDescription(request("POST", {}, { "content-type": "text/plain" }), id, deps)).status, 415);
  const badJson = new Request(`${origin}/api/pinterest/queue/${id}/description`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: "{"
  });
  assert.equal((await handlePinterestDescription(badJson, id, deps)).status, 400);
  assert.equal((await handlePinterestDescription(request("POST", { expectedUpdatedAt: version, junk: "x".repeat(9000) }), id, deps)).status, 413);
  assert.deepEqual(calls, { saves: 0, generations: 0 });
});

test("same-origin local requests work when Next normalizes the loopback hostname", async () => {
  const req = new Request(`http://localhost:3107/api/pinterest/queue/${id}/description`, {
    method: "POST", headers: { host: "127.0.0.1:3107", origin: "http://127.0.0.1:3107", "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: version })
  });
  assert.equal((await handlePinterestDescription(req, id, setup().deps)).status, 200);
});

test("published, processing, needs-review, stale and missing items cannot be edited or regenerated", async () => {
  const variants: Array<[PinQueueRow | null, number]> = [
    [null, 404],
    [{ ...initial, updated_at: "2026-09-14T13:00:00Z" }, 409],
    ...(["processing", "published", "needs_review"] as const).map(status => [{ ...initial, status }, 409] as [PinQueueRow, number])
  ];
  for (const [item, status] of variants) {
    for (const method of ["POST", "PATCH"]) {
      const { deps, calls } = setup({ findItem: async () => item });
      assert.equal((await handlePinterestDescription(request(method), id, deps)).status, status);
      assert.deepEqual(calls, { saves: 0, generations: 0 });
    }
  }
});

test("a missing migration gives an actionable error without calling AI", async () => {
  const legacy = { ...initial } as Partial<PinQueueRow>;
  delete legacy.pin_description;
  const { deps, calls } = setup({ findItem: async () => legacy as PinQueueRow });
  const response = await handlePinterestDescription(request(), id, deps);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /0021/);
  assert.equal(calls.generations, 0);
});

test("save rejects empty and overlong values; preserves complete accepted text", async () => {
  const { deps, calls } = setup();
  for (const description of [null, 123, " ", "x".repeat(501)]) {
    assert.equal((await handlePinterestDescription(request("PATCH", { description, expectedUpdatedAt: version }), id, deps)).status, 400);
  }
  assert.equal(calls.saves, 0);
  assert.equal(validatePinDescription(" x "), "x");
  assert.equal(validatePinDescription("x".repeat(500)).length, 500);
});

test("a publish claim racing a save returns conflict; replayed saves cannot overwrite", async () => {
  const racing = setup({ save: async () => null });
  const body = { description: generated, expectedUpdatedAt: version };
  assert.equal((await handlePinterestDescription(request("PATCH", body), id, racing.deps)).status, 409);
  const { deps, calls } = setup();
  assert.equal((await handlePinterestDescription(request("PATCH", body), id, deps)).status, 200);
  assert.equal((await handlePinterestDescription(request("PATCH", body), id, deps)).status, 409);
  assert.equal(calls.saves, 1);
});

test("AI failure and disabled AI return errors without changing the saved description", async () => {
  for (const cause of [new Error("secret upstream response"), new PinterestDescriptionError("Enable AI in Settings.", 400)]) {
    const { deps, calls } = setup({ generate: async () => { throw cause; } });
    const response = await handlePinterestDescription(request(), id, deps);
    assert.ok(response.status >= 400);
    assert.doesNotMatch(await response.text(), /secret upstream/);
    assert.equal(calls.saves, 0);
  }
});

test("saved Pinterest descriptions take precedence; legacy descriptions end at sentence boundaries", () => {
  assert.equal(getPinDescription({ ...initial, pin_description: generated }), generated);
  assert.equal(getPinDescription(initial), initial.description);
  assert.equal(getPinDescription({ ...initial, description: "A ghost reading a book. " + "Word ".repeat(200) }), "A ghost reading a book.");
  assert.equal(getPinDescription({ ...initial, description: "word ".repeat(200) }), initial.title);
  assert.equal(getPinDescription({ ...initial, description: null }), initial.title);
});

function aiResponse(description: unknown, status = "completed") {
  return { status, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ description }) }] }] };
}

test("Pinterest AI requests short, grounded, price-free prose using only product data", async () => {
  const value = await generatePinterestDescriptionWithAI({
    title: initial.title, description: initial.description, apiKey: "test-key", model: "configured-model",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const payload = JSON.parse(String(options?.body));
      assert.equal(payload.model, "configured-model");
      assert.equal(payload.store, false);
      assert.equal(payload.text.format.strict, true);
      assert.match(payload.input[0].content, /No prices, discounts, hashtags/);
      assert.match(payload.input[0].content, /untrusted product data/);
      assert.deepEqual(JSON.parse(payload.input[1].content), { title: initial.title, description: initial.description });
      return Response.json(aiResponse(generated));
    }
  });
  assert.equal(value, generated);
});

test("Pinterest AI rejects errors, refusals, malformed, incomplete and oversized output without truncation", async () => {
  const responses = [
    aiResponse("x".repeat(501)), aiResponse(null), aiResponse(123), aiResponse(""),
    aiResponse(generated, "incomplete"), { status: "completed", output: [] },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }
  ];
  for (const response of responses) {
    await assert.rejects(generatePinterestDescriptionWithAI({
      title: initial.title, description: initial.description, apiKey: "test", model: "test",
      fetchImpl: async () => Response.json(response)
    }));
  }
  await assert.rejects(generatePinterestDescriptionWithAI({
    title: initial.title, description: null, apiKey: "test", model: "test",
    fetchImpl: async () => new Response("private upstream details", { status: 429 })
  }), /OpenAI request failed \(429\)/);
});

test("cancelled AI requests propagate an aborted signal", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generatePinterestDescriptionWithAI({
    title: initial.title, description: null, apiKey: "test", model: "test", signal: controller.signal,
    fetchImpl: async (_url, options) => { options!.signal!.throwIfAborted(); return Response.json(aiResponse(generated)); }
  }), { name: "AbortError" });
});

test("repository writes only description metadata, with an atomic version and editable-status guard", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, "PATCH");
    assert.equal(url.pathname, "/rest/v1/pin_queue");
    assert.equal(url.searchParams.get("id"), `eq.${id}`);
    assert.equal(url.searchParams.get("updated_at"), `eq.${version}`);
    assert.equal(url.searchParams.get("status"), "in.(pending,failed,cancelled)");
    const body = JSON.parse(String(init.body));
    if (writes === 0) {
      assert.deepEqual(body, { pin_description: generated, pin_description_source: "manual", pin_description_generated_at: null });
    } else {
      assert.deepEqual(Object.keys(body).sort(), ["pin_description", "pin_description_generated_at", "pin_description_source"]);
      assert.equal(body.pin_description, generated);
      assert.equal(body.pin_description_source, "ai");
      assert.ok(Number.isFinite(Date.parse(body.pin_description_generated_at)));
    }
    writes++;
    return Response.json([]);
  };
  try {
    assert.equal(await createPinQueueRepository().saveDescription(id, generated, version), null);
    assert.equal(await createPinQueueRepository().saveDescription(id, generated, version, "ai"), null);
    assert.equal(writes, 2);
  } finally {
    globalThis.fetch = previousFetch;
    process.env = previousEnv;
  }
});
