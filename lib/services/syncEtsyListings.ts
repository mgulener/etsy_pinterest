import { getAllActiveListings } from "@/lib/etsy/client";
import { normalizeEtsyListing } from "@/lib/etsy/listings";
import { getServerEnv } from "@/lib/config/env";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { logger } from "@/lib/utils/logger";
import type {
  BootstrapSettingsRepository,
  EtsyListingsSource,
  SyncListingsRepository,
  SyncQueueRepository
} from "./types";

export type SyncEtsyListingsResult = {
  mode: "sync";
  fetched: number;
  known: number;
  created: number;
  queued: number;
  skippedBecauseBootstrapRequired: boolean;
  errors: Array<{ etsyListingId: number; message: string }>;
};

export async function syncEtsyListingsWithDependencies(input: {
  etsy: EtsyListingsSource;
  listingsRepository: SyncListingsRepository;
  queueRepository: SyncQueueRepository;
  settingsRepository: BootstrapSettingsRepository;
  boardId: string;
}): Promise<SyncEtsyListingsResult> {
  const initialSyncCompleted = await input.settingsRepository.isInitialSyncCompleted();

  if (!initialSyncCompleted) {
    logger.warn("SYNC", "Initial sync is not completed; normal sync skipped");
    return {
      mode: "sync",
      fetched: 0,
      known: 0,
      created: 0,
      queued: 0,
      skippedBecauseBootstrapRequired: true,
      errors: []
    };
  }

  const etsyListings = await input.etsy.getAllActiveListings();
  const normalizedListings = etsyListings.map(normalizeEtsyListing);
  const existingIds = await input.listingsRepository.getExistingEtsyListingIds(
    normalizedListings.map((listing) => listing.etsyListingId)
  );

  let known = 0;
  let created = 0;
  let queued = 0;
  const errors: SyncEtsyListingsResult["errors"] = [];

  for (const listing of normalizedListings) {
    try {
      if (existingIds.has(listing.etsyListingId)) {
        await input.listingsRepository.updateLastSeen(listing);
        known += 1;
        logger.info("SYNC", "Known listing updated", {
          etsyListingId: listing.etsyListingId
        });
        continue;
      }

      await input.listingsRepository.upsertKnownListing(listing);
      const queueResult = await input.queueRepository.enqueueListing(
        listing,
        input.boardId
      );

      created += 1;

      if (queueResult === "created") {
        queued += 1;
      }

      logger.info("SYNC", "New listing queued", {
        etsyListingId: listing.etsyListingId,
        queueResult
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown listing sync error";
      errors.push({ etsyListingId: listing.etsyListingId, message });
      logger.error("SYNC", "Listing sync failed", {
        etsyListingId: listing.etsyListingId,
        message
      });
    }
  }

  return {
    mode: "sync",
    fetched: normalizedListings.length,
    known,
    created,
    queued,
    skippedBecauseBootstrapRequired: false,
    errors
  };
}

export async function syncEtsyListings() {
  const env = getServerEnv();

  return syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings },
    listingsRepository: createListingsRepository(),
    queueRepository: createPinQueueRepository(),
    settingsRepository: createAppSettingsRepository(),
    boardId: env.pinterestBoardId
  });
}
