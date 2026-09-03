import { getAllActiveListings } from "@/lib/etsy/client";
import { normalizeEtsyListing } from "@/lib/etsy/listings";
import { getRequiredEnv } from "@/lib/config/env";
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
  await input.listingsRepository.upsertKnownListings(normalizedListings);

  const known = existingIds.size;
  const newListings = normalizedListings.filter(
    (listing) => !existingIds.has(listing.etsyListingId)
  );
  const created = newListings.length;
  let queued = 0;
  const errors: SyncEtsyListingsResult["errors"] = [];

  logger.info("SYNC", "Listings compared with database", {
    fetched: normalizedListings.length,
    known,
    new: newListings.length
  });

  for (const listing of newListings) {
    try {
      const queueResult = await input.queueRepository.enqueueListing(
        listing,
        input.boardId
      );

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
  return syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings },
    listingsRepository: createListingsRepository(),
    queueRepository: createPinQueueRepository(),
    settingsRepository: createAppSettingsRepository(),
    boardId: getRequiredEnv("PINTEREST_BOARD_ID")
  });
}
