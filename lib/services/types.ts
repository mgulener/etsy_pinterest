import type { EtsyListing, NormalizedEtsyListing } from "@/lib/etsy/types";
import type { InstagramQueueRow, PinQueueRow } from "@/lib/supabase/types";
import type {
  CreateInstagramPostInput,
  CreateInstagramPostResult
} from "@/lib/instagram/types";
import type { CreatePinInput, CreatePinResult } from "@/lib/pinterest/types";

export type EtsyListingsSource = {
  getAllActiveListings(): Promise<EtsyListing[]>;
};

export type SyncListingsRepository = {
  getExistingEtsyListingIds(ids: number[]): Promise<Set<number>>;
  upsertKnownListing(listing: NormalizedEtsyListing): Promise<void>;
  upsertKnownListings(listings: NormalizedEtsyListing[]): Promise<void>;
  updateLastSeen(listing: NormalizedEtsyListing): Promise<void>;
};

export type SyncQueueRepository = {
  enqueueListing(listing: NormalizedEtsyListing, boardId: string): Promise<"created" | "duplicate">;
};

export type InstagramSyncQueueRepository = {
  enqueueListing(listing: NormalizedEtsyListing): Promise<"created" | "duplicate">;
};

export type BootstrapSettingsRepository = {
  isInitialSyncCompleted(): Promise<boolean>;
  setInitialSyncCompleted(value: boolean): Promise<void>;
};

export type PublisherQueueRepository = {
  listPending(limit: number): Promise<PinQueueRow[]>;
  claimPending(id: string): Promise<PinQueueRow | null>;
  markPublished(id: string): Promise<void>;
  markRetryable(id: string, error: string, attemptCount: number): Promise<void>;
  markFailed(id: string, error: string, attemptCount: number): Promise<void>;
  markPendingAfterDryRun(id: string): Promise<void>;
};

export type PublisherPostsRepository = {
  findByEtsyListingId(etsyListingId: number): Promise<unknown | null>;
  createPost(input: {
    etsyListingId: number;
    etsyImageId: number | null;
    pinterestPinId: string;
    pinterestBoardId: string;
  }): Promise<void>;
};

export type PinterestPublisher = {
  createPin(input: CreatePinInput): Promise<CreatePinResult>;
};

export type InstagramPublisherQueueRepository = {
  listPending(limit: number): Promise<InstagramQueueRow[]>;
  claimPending(id: string): Promise<InstagramQueueRow | null>;
  markPublished(id: string): Promise<void>;
  markRetryable(id: string, error: string, attemptCount: number): Promise<void>;
  markFailed(id: string, error: string, attemptCount: number): Promise<void>;
  markPendingAfterDryRun(id: string): Promise<void>;
};

export type InstagramPublisherPostsRepository = {
  findByEtsyListingId(etsyListingId: number): Promise<unknown | null>;
  createPost(input: {
    etsyListingId: number;
    etsyImageId: number | null;
    instagramMediaId: string;
    instagramPermalink?: string;
  }): Promise<void>;
};

export type InstagramPublisher = {
  createPost(input: CreateInstagramPostInput): Promise<CreateInstagramPostResult>;
};
