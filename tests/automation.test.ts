import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getAllActiveListings } from "../lib/etsy/client";
import type { EtsyListing, NormalizedEtsyListing } from "../lib/etsy/types";
import { bootstrapExistingListingsWithDependencies } from "../lib/services/bootstrap";
import { createInstagramPost } from "../lib/instagram/posts";
import { InstagramApiError } from "../lib/instagram/types";
import { publishInstagramPostsWithDependencies } from "../lib/services/publishInstagramPosts";
import { publishPinterestPinsWithDependencies } from "../lib/services/publishPinterestPins";
import { syncEtsyListingsWithDependencies } from "../lib/services/syncEtsyListings";
import type {
  BootstrapSettingsRepository,
  InstagramPublisherPostsRepository,
  InstagramPublisherQueueRepository,
  PublisherPostsRepository,
  PublisherQueueRepository,
  InstagramSyncQueueRepository,
  SyncListingsRepository,
  SyncQueueRepository
} from "../lib/services/types";
import type { InstagramQueueRow, PinQueueRow } from "../lib/supabase/types";

const projectRoot = process.cwd();

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
        imageUrls: [],
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

class MemoryInstagramSyncQueueRepository implements InstagramSyncQueueRepository {
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

function makeInstagramQueueItem(
  input: Partial<InstagramQueueRow> & { id: string; etsy_listing_id: number }
): InstagramQueueRow {
  return {
    id: input.id,
    etsy_listing_id: input.etsy_listing_id,
    etsy_image_id: input.etsy_image_id ?? input.etsy_listing_id + 1000,
    image_url: input.image_url ?? `https://img.test/${input.etsy_listing_id}.jpg`,
    title: input.title ?? `Listing ${input.etsy_listing_id}`,
    description: input.description ?? `Description ${input.etsy_listing_id}`,
    destination_url: input.destination_url ?? `https://etsy.test/listing/${input.etsy_listing_id}`,
    caption: input.caption ?? `Listing ${input.etsy_listing_id}\n\nShop on Etsy: https://etsy.test/listing/${input.etsy_listing_id}`,
    post_mode: input.post_mode ?? "single",
    media_urls: input.media_urls ?? [`https://img.test/${input.etsy_listing_id}.jpg`],
    status: input.status ?? "pending",
    attempt_count: input.attempt_count ?? 0,
    last_error: input.last_error ?? null,
    scheduled_at: input.scheduled_at ?? new Date().toISOString(),
    processing_started_at: input.processing_started_at ?? null,
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

class MemoryInstagramPublisherQueueRepository implements InstagramPublisherQueueRepository {
  items: InstagramQueueRow[];

  constructor(items: InstagramQueueRow[]) {
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

class MemoryInstagramPostsRepository implements InstagramPublisherPostsRepository {
  posts = new Set<number>();
  mediaIds = new Map<number, string>();
  creationIds = new Map<number, string | undefined>();
  mediaTypes = new Map<number, string>();

  constructor(initialPosts: number[] = []) {
    initialPosts.forEach((id) => this.posts.add(id));
  }

  async findByEtsyListingId(etsyListingId: number) {
    return this.posts.has(etsyListingId) ? { etsyListingId } : null;
  }

  async createPost(input: {
    etsyListingId: number;
    instagramMediaId: string;
    instagramCreationId?: string;
    mediaType: string;
  }) {
    this.posts.add(input.etsyListingId);
    this.mediaIds.set(input.etsyListingId, input.instagramMediaId);
    this.creationIds.set(input.etsyListingId, input.instagramCreationId);
    this.mediaTypes.set(input.etsyListingId, input.mediaType);
  }
}

test("canonical route architecture has no legacy app routes", () => {
  const expectedRoutes = [
    "app/api/cron/etsy/sync/route.ts",
    "app/api/cron/pinterest/publish/route.ts",
    "app/api/cron/instagram/publish/route.ts",
    "app/api/etsy/sync/route.ts",
    "app/api/pinterest/publish/route.ts",
    "app/api/instagram/publish/route.ts",
    "app/etsy/listings/page.tsx",
    "app/pinterest/queue/page.tsx",
    "app/pinterest/posts/page.tsx",
    "app/instagram/queue/page.tsx",
    "app/instagram/posts/page.tsx"
  ];
  const forbiddenRoutes = [
    "app/api/cron/sync-etsy/route.ts",
    "app/api/cron/publish-pins/route.ts",
    "app/api/cron/publish-instagram/route.ts",
    "app/api/sync/route.ts",
    "app/api/pins/route.ts",
    "app/api/instagram/route.ts",
    "app/listings/page.tsx",
    "app/queue/page.tsx",
    "app/pins/page.tsx",
    "app/instagram/page.tsx",
    "app/instagram-queue/page.tsx",
    "lib/services/publishPins.ts",
    "lib/services/publishInstagram.ts"
  ];
  const vercelConfig = JSON.parse(
    readFileSync(join(projectRoot, "vercel.json"), "utf8")
  ) as { crons: Array<{ path: string }> };

  expectedRoutes.forEach((route) => {
    assert.equal(existsSync(join(projectRoot, route)), true, `${route} should exist`);
  });

  forbiddenRoutes.forEach((route) => {
    assert.equal(existsSync(join(projectRoot, route)), false, `${route} should not exist`);
  });

  assert.deepEqual(
    vercelConfig.crons.map((cron) => cron.path),
    [
      "/api/cron/etsy/sync",
      "/api/cron/pinterest/publish",
      "/api/cron/instagram/publish"
    ]
  );
});

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

test("new listing enters the Instagram queue when enabled", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const queueRepository = new MemorySyncQueueRepository();
  const instagramQueueRepository = new MemoryInstagramSyncQueueRepository();

  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101)] },
    listingsRepository,
    queueRepository,
    instagramQueueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(result.created, 1);
  assert.equal(result.queued, 1);
  assert.equal(result.instagramQueued, 1);
  assert.equal(instagramQueueRepository.queued[0]?.etsyListingId, 101);
});

test("Etsy listings normalize lowercase images from the API", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const queueRepository = new MemorySyncQueueRepository();

  await syncEtsyListingsWithDependencies({
    etsy: {
      getAllActiveListings: async () => [
        {
          ...etsyListing(101),
          Images: undefined,
          images: [
            {
              listing_image_id: 999,
              url_fullxfull: "https://img.test/lowercase.jpg"
            }
          ]
        }
      ]
    },
    listingsRepository,
    queueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(listingsRepository.listings.get(101)?.imageUrl, "https://img.test/lowercase.jpg");
  assert.equal(listingsRepository.listings.get(101)?.etsyImageId, 999);
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

test("known listing does not enter the Instagram queue", async () => {
  const listingsRepository = new MemoryListingsRepository([101]);
  const queueRepository = new MemorySyncQueueRepository();
  const instagramQueueRepository = new MemoryInstagramSyncQueueRepository();

  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101)] },
    listingsRepository,
    queueRepository,
    instagramQueueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(result.known, 1);
  assert.equal(instagramQueueRepository.queued.length, 0);
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

test("known Etsy auto-renew does not create a duplicate Instagram queue item", async () => {
  const listingsRepository = new MemoryListingsRepository([101]);
  const queueRepository = new MemorySyncQueueRepository();
  const instagramQueueRepository = new MemoryInstagramSyncQueueRepository();

  await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101, "active")] },
    listingsRepository,
    queueRepository,
    instagramQueueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.equal(instagramQueueRepository.queued.length, 0);
});

test("Pinterest API failure does not create a pinterest post", async () => {
  const queueRepository = new MemoryPublisherQueueRepository([
    makeQueueItem({ id: "q1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryPostsRepository();

  const result = await publishPinterestPinsWithDependencies({
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

  const result = await publishPinterestPinsWithDependencies({
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

test("Instagram API failure does not create an instagram post", async () => {
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryInstagramPostsRepository();

  const result = await publishInstagramPostsWithDependencies({
    queueRepository,
    postsRepository,
    instagram: {
      createPost: async () => {
        throw new Error("Instagram unavailable");
      }
    },
    maxPostsPerRun: 10,
    maxRetries: 3,
    dryRun: false
  });

  assert.equal(result.retried, 1);
  assert.equal(postsRepository.posts.size, 0);
});

test("Instagram API success creates an instagram post", async () => {
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryInstagramPostsRepository();

  const result = await publishInstagramPostsWithDependencies({
    queueRepository,
    postsRepository,
    instagram: {
      createPost: async () => ({
        id: "ig-101",
        creationId: "container-101",
        mediaType: "IMAGE",
        permalink: "https://instagram.test/p/101"
      })
    },
    maxPostsPerRun: 10,
    maxRetries: 3,
    dryRun: false
  });

  assert.equal(result.published, 1);
  assert.equal(postsRepository.posts.has(101), true);
  assert.equal(postsRepository.mediaIds.get(101), "ig-101");
  assert.equal(postsRepository.creationIds.get(101), "container-101");
  assert.equal(postsRepository.mediaTypes.get(101), "IMAGE");
  assert.equal(queueRepository.items[0]?.status, "published");
});

test("existing Instagram post skips a second Instagram publish", async () => {
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryInstagramPostsRepository([101]);
  let publishCount = 0;

  const result = await publishInstagramPostsWithDependencies({
    queueRepository,
    postsRepository,
    instagram: {
      createPost: async () => {
        publishCount += 1;
        return { id: "ig-duplicate", mediaType: "IMAGE" };
      }
    },
    maxPostsPerRun: 10,
    maxRetries: 3,
    dryRun: false
  });

  assert.equal(result.skippedDuplicates, 1);
  assert.equal(publishCount, 0);
  assert.equal(queueRepository.items[0]?.status, "published");
});

test("Instagram dry run does not call Meta API publisher", async () => {
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryInstagramPostsRepository();
  let publishCount = 0;

  const result = await publishInstagramPostsWithDependencies({
    queueRepository,
    postsRepository,
    instagram: {
      createPost: async () => {
        publishCount += 1;
        return { id: "ig-101", mediaType: "IMAGE" };
      }
    },
    maxPostsPerRun: 10,
    maxRetries: 3,
    dryRun: true
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.published, 0);
  assert.equal(publishCount, 0);
  assert.equal(postsRepository.posts.size, 0);
  assert.equal(queueRepository.items[0]?.status, "pending");
});

test("same Instagram queue item concurrent processing publishes once", async () => {
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryInstagramPostsRepository();
  let publishCount = 0;

  await Promise.all([
    publishInstagramPostsWithDependencies({
      queueRepository,
      postsRepository,
      instagram: {
        createPost: async () => {
          publishCount += 1;
          return { id: "ig-101", mediaType: "IMAGE" };
        }
      },
      maxPostsPerRun: 10,
      maxRetries: 3,
      dryRun: false
    }),
    publishInstagramPostsWithDependencies({
      queueRepository,
      postsRepository,
      instagram: {
        createPost: async () => {
          publishCount += 1;
          return { id: "ig-101-duplicate", mediaType: "IMAGE" };
        }
      },
      maxPostsPerRun: 10,
      maxRetries: 3,
      dryRun: false
    })
  ]);

  assert.equal(publishCount, 1);
  assert.equal(postsRepository.posts.size, 1);
});

test("Instagram image container success publishes media", async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = "ig-token";
  process.env.INSTAGRAM_ACCOUNT_ID = "ig-account";
  process.env.META_API_VERSION = "v25.0";
  process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS = "1";
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);

    if (url.pathname.endsWith("/ig-account/media")) {
      return Response.json({ id: "container-1" });
    }

    if (url.pathname.endsWith("/container-1")) {
      return Response.json({ status_code: "FINISHED" });
    }

    if (url.pathname.endsWith("/ig-account/media_publish")) {
      return Response.json({ id: "media-1" });
    }

    if (url.pathname.endsWith("/media-1")) {
      return Response.json({ permalink: "https://instagram.test/p/media-1" });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const result = await createInstagramPost({
      imageUrl: "https://img.test/101.jpg",
      caption: "Caption",
      mode: "single"
    });

    assert.equal(result.id, "media-1");
    assert.equal(result.creationId, "container-1");
    assert.equal(result.mediaType, "IMAGE");
    assert.deepEqual(calls, [
      "POST /v25.0/ig-account/media",
      "GET /v25.0/container-1",
      "POST /v25.0/ig-account/media_publish",
      "GET /v25.0/media-1"
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram carousel mode creates child containers then publishes carousel", async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = "ig-token";
  process.env.INSTAGRAM_ACCOUNT_ID = "ig-account";
  process.env.META_API_VERSION = "v25.0";
  process.env.INSTAGRAM_CONTAINER_POLL_INTERVAL_MS = "1";
  const originalFetch = globalThis.fetch;
  const postedBodies: string[] = [];
  let mediaCallCount = 0;

  globalThis.fetch = async (request, init) => {
    const url = new URL(String(request));

    if (init?.method === "POST") {
      postedBodies.push(String(init.body));
    }

    if (url.pathname.endsWith("/ig-account/media")) {
      mediaCallCount += 1;

      if (mediaCallCount === 1) {
        return Response.json({ id: "child-1" });
      }

      if (mediaCallCount === 2) {
        return Response.json({ id: "child-2" });
      }

      return Response.json({ id: "carousel-container" });
    }

    if (
      url.pathname.endsWith("/child-1") ||
      url.pathname.endsWith("/child-2") ||
      url.pathname.endsWith("/carousel-container")
    ) {
      return Response.json({ status_code: "FINISHED" });
    }

    if (url.pathname.endsWith("/ig-account/media_publish")) {
      return Response.json({ id: "carousel-media" });
    }

    if (url.pathname.endsWith("/carousel-media")) {
      return Response.json({ permalink: "https://instagram.test/p/carousel" });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const result = await createInstagramPost({
      imageUrl: "https://img.test/101-1.jpg",
      imageUrls: ["https://img.test/101-1.jpg", "https://img.test/101-2.jpg"],
      caption: "Caption",
      mode: "carousel"
    });

    assert.equal(result.id, "carousel-media");
    assert.equal(result.creationId, "carousel-container");
    assert.equal(result.mediaType, "CAROUSEL");
    assert.equal(postedBodies[0]?.includes("is_carousel_item=true"), true);
    assert.equal(postedBodies[1]?.includes("is_carousel_item=true"), true);
    assert.equal(postedBodies[2]?.includes("media_type=CAROUSEL"), true);
    assert.equal(postedBodies[2]?.includes("children=child-1%2Cchild-2"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Instagram auth error fails without retrying", async () => {
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101 })
  ]);
  const postsRepository = new MemoryInstagramPostsRepository();

  const result = await publishInstagramPostsWithDependencies({
    queueRepository,
    postsRepository,
    instagram: {
      createPost: async () => {
        throw new InstagramApiError("invalid token", "auth_error", false);
      }
    },
    maxPostsPerRun: 10,
    maxRetries: 3,
    dryRun: false
  });

  assert.equal(result.failed, 1);
  assert.equal(result.retried, 0);
  assert.equal(queueRepository.items[0]?.status, "failed");
  assert.equal(queueRepository.items[0]?.attempt_count, 1);
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
    publishPinterestPinsWithDependencies({
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
    publishPinterestPinsWithDependencies({
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
