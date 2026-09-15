import assert from "node:assert/strict";
import test from "node:test";
import { createPinQueueRepository } from "../lib/repositories/pinQueueRepository";
import { createAutomaticPinterestDescriptionGenerator } from "../lib/pinterest/automaticDescriptions";
import { syncEtsyListingsWithDependencies } from "../lib/services/syncEtsyListings";
import type { NormalizedEtsyListing } from "../lib/etsy/types";

const listing = (id: number): NormalizedEtsyListing => ({
  etsyListingId: id, etsyShopSectionId: null, etsyImageId: id, imageUrl: "https://image.test/shirt.jpg", imageUrls: [],
  title: `Shirt ${id}`, description: "Original Etsy description", destinationUrl: `https://etsy.test/listing/${id}`,
  state: "active", originalCreationTimestamp: null
});

test("automatic Pinterest AI honors the AI toggle and fails closed for missing credentials", () => {
  assert.equal(createAutomaticPinterestDescriptionGenerator({ aiCaptionsEnabled: false, openaiApiKey: null, openaiModel: null }), undefined);
  const generate = createAutomaticPinterestDescriptionGenerator({ aiCaptionsEnabled: true, openaiApiKey: null, openaiModel: "test" });
  assert.throws(() => generate!([{ id: "1", title: "Shirt", description: null }]), /Configure the OpenAI key/);
});

test("all Pinterest enqueue paths generate before saving, protect existing text and recover failed syncs", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const rows = new Map<number, Record<string, unknown>>([[1, { etsy_listing_id: 1, pin_description: "Manual edit" }]]);
  const published = new Set([2]);
  let failInsert = false;
  let writes = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://db.test");
    if (init?.method === "POST") {
      assert.equal(url.pathname, "/rest/v1/pin_queue");
      assert.match(new Headers(init.headers).get("prefer") ?? "", /resolution=ignore-duplicates/);
      if (failInsert) return Response.json({ message: "DB unavailable" }, { status: 503 });
      const inserted: Record<string, unknown>[] = [];
      for (const row of JSON.parse(String(init.body))) {
        if (rows.has(row.etsy_listing_id)) continue;
        rows.set(row.etsy_listing_id, row); inserted.push(row); writes++;
      }
      return Response.json(inserted);
    }
    const ids = (url.searchParams.get("etsy_listing_id") ?? "").slice(4, -1).split(",").map(Number);
    const existing = url.pathname === "/rest/v1/pinterest_posts" ? published : new Set(rows.keys());
    return Response.json(ids.filter(id => existing.has(id)).map(etsy_listing_id => ({ etsy_listing_id })));
  };
  try {
    const generated: string[] = [];
    let aiFailure = false;
    const repo = createPinQueueRepository({ generateDescriptions: async products => {
      if (aiFailure) throw new Error("AI unavailable");
      assert.ok(products.length <= 10);
      products.forEach(p => generated.push(p.id));
      return new Map(products.map(p => [p.id, `AI description for ${p.id}.`]));
    } });
    assert.equal(await repo.enqueueListings([1, 2, 3, 3].map(id => ({ listing: listing(id), boardId: "board" }))), 1);
    assert.deepEqual(generated, ["3"]);
    assert.equal(rows.get(1)?.pin_description, "Manual edit");
    assert.equal(rows.get(3)?.description, "Original Etsy description");
    assert.equal(rows.get(3)?.pin_description, "AI description for 3.");
    assert.equal(rows.get(3)?.pin_description_source, "ai");
    assert.ok(rows.get(3)?.pin_description_generated_at);
    assert.equal(await repo.enqueueListing(listing(3), "board"), "duplicate");
    assert.deepEqual(generated, ["3"]);
    assert.equal(await repo.enqueueListing(listing(4), "board"), "created");
    assert.equal(writes, 2);

    aiFailure = true;
    await assert.rejects(repo.enqueueListing(listing(5), "board"), /AI unavailable/);
    assert.equal(rows.has(5), false);
    aiFailure = false;
    failInsert = true;
    await assert.rejects(repo.enqueueListing(listing(6), "board"), /DB unavailable/);
    assert.equal(rows.has(6), false);
    failInsert = false;

    let known = false;
    const input = {
      etsy: { getAllActiveListings: async () => [{ listing_id: 7, title: "New shirt", description: "Product details", state: "active" }] },
      listingsRepository: {
        getExistingEtsyListingIds: async () => new Set<number>(),
        savePendingListing: async () => {},
        upsertKnownListings: async () => {},
        upsertKnownListing: async () => { known = true; },
        updateLastSeen: async () => {}
      },
      queueRepository: { enqueueListing: repo.enqueueListing },
      settingsRepository: { isInitialSyncCompleted: async () => true, setInitialSyncCompleted: async () => {} },
      boardId: "board"
    };
    aiFailure = true;
    const failed = await syncEtsyListingsWithDependencies(input);
    assert.equal(failed.errors.length, 1);
    assert.equal(known, false);
    assert.equal(rows.has(7), false);
    aiFailure = false;
    const retried = await syncEtsyListingsWithDependencies(input);
    assert.equal(retried.queued, 1);
    assert.equal(known, true);
    assert.equal(rows.get(7)?.pin_description_source, "ai");
  } finally {
    globalThis.fetch = previousFetch;
    process.env = previousEnv;
  }
});
