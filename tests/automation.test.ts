import assert from "node:assert/strict";
import test from "node:test";
import { getAllActiveListings } from "../lib/etsy/client";
import type { EtsyListing, NormalizedEtsyListing } from "../lib/etsy/types";
import { bootstrapExistingListingsWithDependencies } from "../lib/services/bootstrap";
import { publishPinsWithDependencies } from "../lib/services/publishPins";
import { syncEtsyListingsWithDependencies } from "../lib/services/syncEtsyListings";
import type {
  BootstrapSettingsRepository,
  PublisherPostsRepository,
  PublisherQueueRepository,
  SyncListingsRepository,
  SyncQueueRepository
} from "../lib/services/types";
import type { PinQueueRow } from "../lib/supabase/types";

function etsyListing(id: number, state = "active"): EtsyListing {
  return {
    listing_id: id,
    title: `Listing ${id}`,
    description: `Description ${id}`,
    url: `https://etsy.test/listing/${id}`,
    state,
    original_creation_timestamp: 1_700_000_000,
    Images: [
      {
        listing_image_id: id + 1000,
        url_fullxfull: `https://img.test/${id}.jpg`
      }
    ]
  };
}

class MemorySettingsRepository implements BootstrapSettingsRepository {
  completed = true;

  constructor(completed = true) {
    this.completed = completed;
  }

  async isInitialSyncCompleted() {
    return this.completed;
  }

  async setInitialSyncCompleted(value: boolean) {
    this.completed = value;
  }
}

class MemoryListingsRepository implements SyncListingsRepository {
  listings = new Map<number, NormalizedEtsyListing>();

  constructor(initialIds: number[] = []) {
    initialIds.forEach((id) => {
      this.listings.set(id, {
        etsyListingId: id,
        etsyImageId: null,
        imageUrl: null,
        title: `Existing ${id}`,
        description: null,
        destinationUrl: null,
        state: "active",
        originalCreationTimestamp: null
      });
    });
  }

  async getExistingEtsyListingIds(ids: number[]) {
    return new Set(ids.filter((id) => this.listings.has(id)));
  }

  async upsertKnownListing(listing: NormalizedEtsyListing) {
    this.listings.set(listing.etsyListingId, listing);
  }

  async upsertKnownListings(listings: NormalizedEtsyListing[]) {
    listings.forEach((listing) => this.listings.set(listing.etsyListingId, listing));
  }

  async updateLastSeen(listing: NormalizedEtsyListing) {
    this.listings.set(listing.etsyListingId, listing);
  }
}

class MemorySyncQueueRepository implements SyncQueueRepository {
  queued: NormalizedEtsyListing[] = [];

  async enqueueListing(listing: NormalizedEtsyListing) {
    if (this.queued.some((item) => item.etsyListingId === listing.etsyListingId)) {
      return "duplicate" as const;
    }

    this.queued.push(listing);
    return "created" as const;
  }
}

function makeQueueItem(input: Partial<PinQueueRow> & { id: string; etsy_listing_id: number }): PinQueueRow {
  return {
    id: input.id,
    etsy_listing_id: input.etsy_listing_id,
    etsy_image_id: input.etsy_image_id ?? input.etsy_listing_id + 1000,
    image_url: input.image_url ?? `https://img.test/${input.etsy_listing_id}.jpg`,
    title: input.title ?? `Listing ${input.etsy_listing_id}`,
    description: input.description ?? `Description ${input.etsy_listing_id}`,
    destination_url: input.destination_url ?? `https://etsy.test/listing/${input.etsy_listing_id}`,
    board_id: input.board_id ?? "board-1",
    status: input.status ?? "pending",
    attempt_count: input.attempt_count ?? 0,
    last_error: input.last_error ?? null,
    scheduled_at: input.scheduled_at ?? new Date().toISOString(),
    created_at: input.created_at ?? new Date().toISOString(),
    updated_at: input.updated_at ?? new Date().toISOString(),
    processed_at: input.processed_at ?? null
  };
}

class MemoryPublisherQueueRepository implements PublisherQueueRepository {
  items: PinQueueRow[];

  constructor(items: PinQueueRow[]) {
    this.items = items;
  }

  async listPending(limit: number) {
    return this.items.filter((item) => item.status === "pending").slice(0, limit);
  }

  async claimPending(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (!item || item.status !== "pending") {
      return null;
    }

    item.status = "processing";
    return item;
  }

  async markPublished(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (item) {
      item.status = "published";
      item.processed_at = new Date().toISOString();
    }
  }

  async markRetryable(id: string, error: string, attemptCount: number) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (item) {
      item.status = "pending";
      item.last_error = error;
      item.attempt_count = attemptCount;
    }
  }

  async markFailed(id: string, error: string, attemptCount: number) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (item) {
      item.status = "failed";
      item.last_error = error;
      item.attempt_count = attemptCount;
    }
  }

  async markPendingAfterDryRun(id: string) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (item) {
      item.status = "pending";
    }
  }
}

class MemoryPostsRepository implements PublisherPostsRepository {
  posts = new Set<number>();

  constructor(initialPosts: number[] = []) {
    initialPosts.forEach((id) => this.posts.add(id));
  }

  async findByEtsyListingId(etsyListingId: number) {
    return this.posts.has(etsyListingId) ? { etsyListingId } : null;
  }

  async createPost(input: { etsyListingId: number }) {
    this.posts.add(input.etsyListingId);
  }
}

test("new listing enters the Pinterest queue", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const queueRepository = new MemorySyncQueueRepository();

  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101)] },
    listingsRepository,
    queueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(result.created, 1);
  assert.equal(result.queued, 1);
  assert.equal(queueRepository.queued[0]?.etsyListingId, 101);
});

test("known listing does not enter the Pinterest queue", async () => {
  const listingsRepository = new MemoryListingsRepository([101]);
  const queueRepository = new MemorySyncQueueRepository();

  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101)] },
    listingsRepository,
    queueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(result.known, 1);
  assert.equal(queueRepository.queued.length, 0);
});

test("known sold-out listing renewed with the same listing id is not new", async () => {
  const listingsRepository = new MemoryListingsRepository([101]);
  const queueRepository = new MemorySyncQueueRepository();

  await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101, "active")] },
    listingsRepository,
    queueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(queueRepository.queued.length, 0);
  assert.equal(listingsRepository.listings.get(101)?.state, "active");
});

test("Pinterest API failure does not create a pinterest post", async () => {
  const queueRepository = new MemoryPublisherQueueRepository([
    makeQueueItem({ id: "q1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryPostsRepository();

  const result = await publishPinsWithDependencies({
    queueRepository,
    postsRepository,
    pinterest: {
      createPin: async () => {
        throw new Error("Pinterest unavailable");
      }
    },
    maxPinsPerRun: 10,
    maxRetries: 3,
    dryRun: false
  });

  assert.equal(result.retried, 1);
  assert.equal(postsRepository.posts.size, 0);
});

test("Pinterest API success creates a pinterest post", async () => {
  const queueRepository = new MemoryPublisherQueueRepository([
    makeQueueItem({ id: "q1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryPostsRepository();

  const result = await publishPinsWithDependencies({
    queueRepository,
    postsRepository,
    pinterest: { createPin: async () => ({ id: "pin-101" }) },
    maxPinsPerRun: 10,
    maxRetries: 3,
    dryRun: false
  });

  assert.equal(result.published, 1);
  assert.equal(postsRepository.posts.has(101), true);
  assert.equal(queueRepository.items[0]?.status, "published");
});

test("Etsy pagination fetches 1300+ listings", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.ETSY_API_KEY = "etsy-key";
  process.env.ETSY_ACCESS_TOKEN = "etsy-token";
  process.env.ETSY_SHOP_ID = "123";
  process.env.PINTEREST_ACCESS_TOKEN = "pinterest-token";
  process.env.PINTEREST_BOARD_ID = "board-1";
  process.env.CRON_SECRET = "cron-secret";
  process.env.ADMIN_PASSWORD = "admin-password";

  const originalFetch = globalThis.fetch;
  const total = 1305;

  globalThis.fetch = async (request) => {
    const url = new URL(String(request));
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const results = Array.from(
      { length: Math.max(Math.min(limit, total - offset), 0) },
      (_, index) => etsyListing(offset + index + 1)
    );

    return Response.json({ count: total, results });
  };

  try {
    const listings = await getAllActiveListings();
    assert.equal(listings.length, total);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bootstrap saves existing listings without queueing", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const settingsRepository = new MemorySettingsRepository(false);

  const result = await bootstrapExistingListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101), etsyListing(102)] },
    listingsRepository,
    settingsRepository
  });

  assert.equal(result.saved, 2);
  assert.equal(result.queued, 0);
  assert.equal(settingsRepository.completed, true);
  assert.equal(listingsRepository.listings.size, 2);
});

test("new listing after bootstrap enters the queue", async () => {
  const listingsRepository = new MemoryListingsRepository([101, 102]);
  const queueRepository = new MemorySyncQueueRepository();

  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101), etsyListing(102), etsyListing(103)] },
    listingsRepository,
    queueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(result.created, 1);
  assert.deepEqual(queueRepository.queued.map((listing) => listing.etsyListingId), [103]);
});

test("same queue item concurrent processing creates at most one Pinterest pin", async () => {
  const queueRepository = new MemoryPublisherQueueRepository([
    makeQueueItem({ id: "q1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryPostsRepository();
  let createPinCount = 0;

  await Promise.all([
    publishPinsWithDependencies({
      queueRepository,
      postsRepository,
      pinterest: {
        createPin: async () => {
          createPinCount += 1;
          return { id: "pin-101" };
        }
      },
      maxPinsPerRun: 10,
      maxRetries: 3,
      dryRun: false
    }),
    publishPinsWithDependencies({
      queueRepository,
      postsRepository,
      pinterest: {
        createPin: async () => {
          createPinCount += 1;
          return { id: "pin-101-duplicate" };
        }
      },
      maxPinsPerRun: 10,
      maxRetries: 3,
      dryRun: false
    })
  ]);

  assert.equal(createPinCount, 1);
  assert.equal(postsRepository.posts.size, 1);
});

test("published listing renewed by Etsy does not create a duplicate pin", async () => {
  const listingsRepository = new MemoryListingsRepository([101]);
  const queueRepository = new MemorySyncQueueRepository();

  await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101, "active")] },
    listingsRepository,
    queueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(queueRepository.queued.length, 0);
});
