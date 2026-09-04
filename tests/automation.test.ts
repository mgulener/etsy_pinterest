import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getAllActiveListings } from "../lib/etsy/client";
import { extractEtsyShopId } from "../lib/etsy/auth";
import { normalizeEtsyListing } from "../lib/etsy/listings";
import type { EtsyListing, NormalizedEtsyListing } from "../lib/etsy/types";
import { bootstrapExistingListingsWithDependencies } from "../lib/services/bootstrap";
import { buildInstagramCaption, buildInstagramHashtags } from "../lib/instagram/caption";
import { generateInstagramCaptionWithAI } from "../lib/instagram/aiCaption";
import { createInstagramPost } from "../lib/instagram/posts";
import { getSeasonalQueuePriority } from "../lib/queue/scheduling";
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
  queued: Array<{ listing: NormalizedEtsyListing; scheduledAt?: string }> = [];

  async enqueueListing(listing: NormalizedEtsyListing, _boardId: string, options?: { scheduledAt?: string }) {
    if (this.queued.some((item) => item.listing.etsyListingId === listing.etsyListingId)) {
      return "duplicate" as const;
    }

    this.queued.push({ listing, scheduledAt: options?.scheduledAt });
    return "created" as const;
  }
}

class MemoryInstagramSyncQueueRepository implements InstagramSyncQueueRepository {
  queued: Array<{
    listing: NormalizedEtsyListing;
    caption?: string;
    captionSource?: "rule" | "ai";
    scheduledAt?: string;
  }> = [];

  async enqueueListing(
    listing: NormalizedEtsyListing,
    options?: { caption?: string; captionSource?: "rule" | "ai"; scheduledAt?: string }
  ) {
    if (this.queued.some((item) => item.listing.etsyListingId === listing.etsyListingId)) {
      return "duplicate" as const;
    }

    this.queued.push({
      listing,
      caption: options?.caption,
      captionSource: options?.captionSource,
      scheduledAt: options?.scheduledAt
    });
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
    schedule_locked: input.schedule_locked ?? false,
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
    available_media_urls: input.available_media_urls ?? input.media_urls ?? [`https://img.test/${input.etsy_listing_id}.jpg`],
    caption_source: input.caption_source ?? "rule",
    caption_generated_at: input.caption_generated_at ?? null,
    status: input.status ?? "pending",
    attempt_count: input.attempt_count ?? 0,
    last_error: input.last_error ?? null,
    scheduled_at: input.scheduled_at ?? new Date().toISOString(),
    schedule_locked: input.schedule_locked ?? false,
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

  async markRetryable(id: string, error: string, attemptCount: number, retryScheduledAt: string) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (item) {
      item.status = "pending";
      item.last_error = error;
      item.attempt_count = attemptCount;
      item.scheduled_at = retryScheduledAt;
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

  async markRetryable(id: string, error: string, attemptCount: number, retryScheduledAt: string) {
    const item = this.items.find((candidate) => candidate.id === id);

    if (item) {
      item.status = "pending";
      item.last_error = error;
      item.attempt_count = attemptCount;
      item.scheduled_at = retryScheduledAt;
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

test("Etsy sync runs as a durable background job", () => {
  const adminActions = readFileSync(join(projectRoot, "app/actions/admin.ts"), "utf8");
  const dashboardPage = readFileSync(join(projectRoot, "app/dashboard/page.tsx"), "utf8");
  const progressComponent = readFileSync(join(projectRoot, "app/components/SyncJobProgress.tsx"), "utf8");
  const migration = readFileSync(join(projectRoot, "supabase/migrations/0006_sync_jobs.sql"), "utf8");
  const limitMigration = readFileSync(join(projectRoot, "supabase/migrations/0007_add_sync_job_limit.sql"), "utf8");

  assert.match(adminActions, /after\(\(\) => runEtsySyncJob/);
  assert.match(dashboardPage, /<SyncJobProgress initialJob=\{latestSyncJob\}/);
  assert.match(progressComponent, /\/api\/jobs\/etsy-sync\/latest/);
  assert.match(progressComponent, /\/api\/jobs\/etsy-sync\/run/);
  assert.match(migration, /create table public\.sync_jobs/);
  assert.match(migration, /sync_limit integer/);
  assert.match(limitMigration, /add column if not exists sync_limit integer/);
  assert.match(dashboardPage, /name="limit" value="100"/);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0008_add_instagram_available_media_urls.sql")), true);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0009_add_etsy_listing_image_urls.sql")), true);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0010_add_ai_caption_settings.sql")), true);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0011_add_instagram_ai_caption_job_type.sql")), true);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0012_add_queue_caption_source.sql")), true);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0013_add_queue_schedule_lock.sql")), true);
  assert.equal(existsSync(join(projectRoot, "supabase/migrations/0014_add_instagram_publish_job_type.sql")), true);
});

test("queue action UI uses icons and enabled platform settings", () => {
  const listingsPage = readFileSync(join(projectRoot, "app/etsy/listings/page.tsx"), "utf8");
  const pinterestQueuePage = readFileSync(join(projectRoot, "app/pinterest/queue/page.tsx"), "utf8");
  const scheduleButton = readFileSync(join(projectRoot, "app/components/ScheduleButton.tsx"), "utf8");
  const captionModalEditor = readFileSync(join(projectRoot, "app/instagram/queue/CaptionModalEditor.tsx"), "utf8");
  const instagramCaptionRoute = readFileSync(join(projectRoot, "app/api/instagram/caption/route.ts"), "utf8");

  assert.match(listingsPage, /settings\.pinterestEnabled/);
  assert.match(listingsPage, /settings\.instagramEnabled/);
  const instagramQueuePage = readFileSync(join(projectRoot, "app/instagram/queue/page.tsx"), "utf8");

  assert.match(pinterestQueuePage, /function CancelIcon/);
  assert.match(pinterestQueuePage, /\/pinterest\/queue">Clear/);
  assert.match(scheduleButton, /datetime-local/);
  assert.match(instagramQueuePage, /function CancelIcon/);
  assert.doesNotMatch(pinterestQueuePage, />C<\/span>/);
  assert.doesNotMatch(instagramQueuePage, />C<\/span>/);
  assert.match(instagramQueuePage, /generateInstagramCaptionsAction/);
  assert.match(instagramQueuePage, /rebuildInstagramScheduleAction/);
  assert.match(instagramQueuePage, /caption_source/);
  assert.match(instagramQueuePage, /schedule_locked/);
  assert.match(instagramQueuePage, /Europe\/Istanbul/);
  assert.match(instagramQueuePage, /\/instagram\/queue">Clear/);
  assert.match(instagramQueuePage, /instagram-ai-captions\/latest/);
  assert.match(captionModalEditor, /fetch\("\/api\/instagram\/caption"/);
  assert.match(captionModalEditor, /value=\{draftCaption\}/);
  assert.doesNotMatch(captionModalEditor, /formAction=\{regenerateInstagramCaptionAction\}/);
  assert.match(instagramCaptionRoute, /NextResponse\.json\(\{ caption \}\)/);
  assert.equal(existsSync(join(projectRoot, "app/api/jobs/instagram-ai-captions/latest/route.ts")), true);
  assert.equal(existsSync(join(projectRoot, "app/api/jobs/instagram-ai-captions/run/route.ts")), true);
});

test("canonical route architecture has no legacy app routes", () => {
  const expectedRoutes = [
    "app/api/cron/etsy/sync/route.ts",
    "app/api/cron/pinterest/publish/route.ts",
    "app/api/cron/instagram/publish/route.ts",
    "app/api/etsy/sync/route.ts",
    "app/api/pinterest/publish/route.ts",
    "app/api/instagram/publish/route.ts",
    "app/api/instagram/caption/route.ts",
    "app/api/jobs/instagram-publish/latest/route.ts",
    "app/api/jobs/instagram-publish/run/route.ts",
    "app/api/jobs/etsy-sync/latest/route.ts",
    "app/api/jobs/etsy-sync/run/route.ts",
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
  assert.equal(queueRepository.queued[0]?.listing.etsyListingId, 101);
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
  assert.equal(instagramQueueRepository.queued[0]?.listing.etsyListingId, 101);
});

test("sync can run with Pinterest queue disabled", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const instagramQueueRepository = new MemoryInstagramSyncQueueRepository();

  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101)] },
    listingsRepository,
    instagramQueueRepository,
    settingsRepository: new MemorySettingsRepository(true)
  });

  assert.equal(result.created, 1);
  assert.equal(result.queued, 0);
  assert.equal(result.instagramQueued, 1);
  assert.equal(instagramQueueRepository.queued[0]?.listing.etsyListingId, 101);
});

test("new listings are queued by seasonal priority with 15 minute schedule spacing", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const queueRepository = new MemorySyncQueueRepository();
  const instagramQueueRepository = new MemoryInstagramSyncQueueRepository();
  const now = Date.now();

  await syncEtsyListingsWithDependencies({
    etsy: {
      getAllActiveListings: async () => [
        { ...etsyListing(201), title: "Christmas Ornament", original_creation_timestamp: 100 },
        { ...etsyListing(202), title: "September Classroom Decor", original_creation_timestamp: 90 },
        { ...etsyListing(203), title: "Halloween Party Sign", original_creation_timestamp: 80 }
      ]
    },
    listingsRepository,
    queueRepository,
    instagramQueueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    boardId: "board-1"
  });

  assert.deepEqual(
    instagramQueueRepository.queued.map((item) => item.listing.etsyListingId),
    [202, 203, 201]
  );
  assert.equal(getSeasonalQueuePriority(instagramQueueRepository.queued[0].listing), 10);

  const first = new Date(instagramQueueRepository.queued[0].scheduledAt ?? "").getTime();
  const second = new Date(instagramQueueRepository.queued[1].scheduledAt ?? "").getTime();
  const third = new Date(instagramQueueRepository.queued[2].scheduledAt ?? "").getTime();

  assert.equal(second - first, 15 * 60_000);
  assert.equal(third - second, 15 * 60_000);
  assert.equal(first >= now - 1000, true);
});

test("new Instagram queue items can receive AI captions during Etsy sync", async () => {
  const listingsRepository = new MemoryListingsRepository();
  const instagramQueueRepository = new MemoryInstagramSyncQueueRepository();
  const generatedFor: number[] = [];

  await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [etsyListing(101)] },
    listingsRepository,
    instagramQueueRepository,
    settingsRepository: new MemorySettingsRepository(true),
    instagramCaptionGenerator: async (listing) => {
      generatedFor.push(listing.etsyListingId);
      return "AI caption\n\n#specificproduct";
    }
  });

  assert.deepEqual(generatedFor, [101]);
  assert.equal(instagramQueueRepository.queued[0]?.caption, "AI caption\n\n#specificproduct");
  assert.equal(instagramQueueRepository.queued[0]?.captionSource, "ai");
});

test("Instagram captions use product-specific hashtags", () => {
  const listing: NormalizedEtsyListing = {
    etsyListingId: 101,
    etsyImageId: 1101,
    imageUrl: "https://img.test/101.jpg",
    imageUrls: ["https://img.test/101.jpg"],
    title: "Personalized Wooden Christmas Ornament for Baby",
    description: "Rustic cedar keepsake ornament for a first Christmas nursery gift.",
    destinationUrl: "https://etsy.test/listing/101",
    state: "active",
    originalCreationTimestamp: 1_700_000_000
  };

  const hashtags = buildInstagramHashtags(listing);
  const caption = buildInstagramCaption(listing);

  assert.equal(hashtags.includes("#christmasdecor"), true);
  assert.equal(hashtags.includes("#ornament"), true);
  assert.equal(hashtags.includes("#babygift"), true);
  assert.equal(hashtags.includes("#wooddecor"), true);
  assert.equal(hashtags.includes("#personalized"), false);
  assert.equal(caption.includes("#etsyfinds #giftideas #handmade"), false);
  assert.equal(caption.includes("#christmasdecor"), true);
  assert.equal(caption.length <= 2200, true);
});

test("AI Instagram captions use structured product-specific hashtags", async () => {
  const listing: NormalizedEtsyListing = {
    etsyListingId: 101,
    etsyImageId: 1101,
    imageUrl: "https://img.test/101.jpg",
    imageUrls: ["https://img.test/101.jpg"],
    title: "St. Patrick's Day Classroom Bulletin Board Decor",
    description: "Green shamrock printable signs for March classroom displays and teacher bulletin boards.",
    destinationUrl: "https://etsy.test/listing/101",
    state: "active",
    originalCreationTimestamp: 1_700_000_000
  };
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init?.headers instanceof Headers, false);
    const body = JSON.parse(String(init?.body));

    assert.equal(body.model, "gpt-test");
    assert.match(body.input[1].content, /St\. Patrick's Day Classroom/);

    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        caption: "Bring a festive March touch to your classroom display with printable shamrock decor.",
        hashtags: [
          "st patricks day decor",
          "classroom decor",
          "bulletin board ideas",
          "teacher printable",
          "march classroom",
          "shamrock decor",
          "green classroom",
          "holiday bulletin board"
        ]
      })
    }), { status: 200 });
  };

  const caption = await generateInstagramCaptionWithAI({
    listing,
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl
  });

  assert.match(caption, /#stpatricksdaydecor/);
  assert.match(caption, /#classroomdecor/);
  assert.match(caption, /#bulletinboardideas/);
  assert.doesNotMatch(caption, /#etsyfinds/);
  assert.equal(caption.length <= 2200, true);
});

test("Etsy listings decode HTML entities from the API", () => {
  const listing = normalizeEtsyListing({
    ...etsyListing(101),
    title: "St. Patrick&#39;s Day Decor &amp; Printable",
    description: "Irish party &#x27;green&#x27; wall art"
  });

  assert.equal(listing.title, "St. Patrick's Day Decor & Printable");
  assert.equal(listing.description, "Irish party 'green' wall art");
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
  const initialScheduledAt = new Date(Date.now() - 60_000).toISOString();
  const queueRepository = new MemoryPublisherQueueRepository([
    makeQueueItem({ id: "q1", etsy_listing_id: 101, scheduled_at: initialScheduledAt })
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
  assert.equal(queueRepository.items[0]?.status, "pending");
  assert.equal(queueRepository.items[0]?.attempt_count, 1);
  assert.equal(new Date(queueRepository.items[0]?.scheduled_at ?? 0).getTime() > new Date(initialScheduledAt).getTime(), true);
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
  const initialScheduledAt = new Date(Date.now() - 60_000).toISOString();
  const queueRepository = new MemoryInstagramPublisherQueueRepository([
    makeInstagramQueueItem({ id: "igq1", etsy_listing_id: 101, scheduled_at: initialScheduledAt })
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
  assert.equal(queueRepository.items[0]?.status, "pending");
  assert.equal(queueRepository.items[0]?.attempt_count, 1);
  assert.equal(new Date(queueRepository.items[0]?.scheduled_at ?? 0).getTime() > new Date(initialScheduledAt).getTime(), true);
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

test("Etsy listing fetch can be limited for test sync", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.ETSY_API_KEY = "etsy-key";
  process.env.ETSY_ACCESS_TOKEN = "etsy-token";
  process.env.ETSY_SHOP_ID = "123";

  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async (request) => {
    calls += 1;
    const url = new URL(String(request));
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    const total = 1305;
    const results = Array.from(
      { length: Math.max(Math.min(limit, total - offset), 0) },
      (_, index) => etsyListing(offset + index + 1)
    );

    return Response.json({ count: total, results });
  };

  try {
    const listings = await getAllActiveListings(undefined, 100);
    assert.equal(listings.length, 100);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Etsy OAuth callback does not leak provider errors in redirect URLs", () => {
  const callbackRoute = readFileSync(join(projectRoot, "app/api/auth/etsy/callback/route.ts"), "utf8");
  const settingsPage = readFileSync(join(projectRoot, "app/settings/page.tsx"), "utf8");

  assert.doesNotMatch(callbackRoute, /message: errorMessage/);
  assert.doesNotMatch(callbackRoute, /warning: result\.warning/);
  assert.match(callbackRoute, /warning: "shop-id"/);
  assert.match(settingsPage, /keystring:shared_secret/);
});

test("Etsy shop ID can be extracted from OAuth shop responses", () => {
  assert.equal(extractEtsyShopId({ shop_id: 123 }), 123);
  assert.equal(extractEtsyShopId({ results: [{ shop_id: 456 }] }), 456);
  assert.throws(
    () => extractEtsyShopId({ results: [] }),
    /Etsy shop ID was not found/
  );
});

test("Etsy auth explains missing OAuth token", async () => {
  const previous = {
    apiKey: process.env.ETSY_API_KEY,
    accessToken: process.env.ETSY_ACCESS_TOKEN,
    refreshToken: process.env.ETSY_REFRESH_TOKEN,
    shopId: process.env.ETSY_SHOP_ID
  };

  process.env.ETSY_API_KEY = "etsy-key";
  delete process.env.ETSY_ACCESS_TOKEN;
  delete process.env.ETSY_REFRESH_TOKEN;
  process.env.ETSY_SHOP_ID = "123";

  try {
    await assert.rejects(
      getAllActiveListings(),
      /Missing Etsy OAuth token\. Connect Etsy from Settings\./
    );
  } finally {
    if (previous.apiKey === undefined) delete process.env.ETSY_API_KEY;
    else process.env.ETSY_API_KEY = previous.apiKey;

    if (previous.accessToken === undefined) delete process.env.ETSY_ACCESS_TOKEN;
    else process.env.ETSY_ACCESS_TOKEN = previous.accessToken;

    if (previous.refreshToken === undefined) delete process.env.ETSY_REFRESH_TOKEN;
    else process.env.ETSY_REFRESH_TOKEN = previous.refreshToken;

    if (previous.shopId === undefined) delete process.env.ETSY_SHOP_ID;
    else process.env.ETSY_SHOP_ID = previous.shopId;
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
  assert.deepEqual(queueRepository.queued.map((item) => item.listing.etsyListingId), [103]);
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
