import { getAllActiveListings } from "@/lib/etsy/client";
import { normalizeEtsyListing } from "@/lib/etsy/listings";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { logger } from "@/lib/utils/logger";
import type {
  BootstrapSettingsRepository,
  EtsyListingsSource,
  SyncListingsRepository
} from "./types";

export type BootstrapResult = {
  mode: "bootstrap";
  skipped: boolean;
  fetched: number;
  saved: number;
  queued: 0;
  errors: Array<{ etsyListingId: number; message: string }>;
};

export async function bootstrapExistingListingsWithDependencies(input: {
  etsy: EtsyListingsSource;
  listingsRepository: SyncListingsRepository;
  settingsRepository: BootstrapSettingsRepository;
}): Promise<BootstrapResult> {
  const initialSyncCompleted = await input.settingsRepository.isInitialSyncCompleted();

  if (initialSyncCompleted) {
    logger.warn("BOOTSTRAP", "Bootstrap skipped because initial sync is already complete");
    return {
      mode: "bootstrap",
      skipped: true,
      fetched: 0,
      saved: 0,
      queued: 0,
      errors: []
    };
  }

  const etsyListings = await input.etsy.getAllActiveListings();
  const normalizedListings = etsyListings.map(normalizeEtsyListing);
  const errors: BootstrapResult["errors"] = [];

  try {
    await input.listingsRepository.upsertKnownListings(normalizedListings);
    logger.info("BOOTSTRAP", "Known listings saved without queueing", {
      count: normalizedListings.length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bootstrap error";
    errors.push({ etsyListingId: 0, message });
    logger.error("BOOTSTRAP", "Batch bootstrap failed", { message });
  }

  if (errors.length === 0) {
    await input.settingsRepository.setInitialSyncCompleted(true);
  }

  return {
    mode: "bootstrap",
    skipped: false,
    fetched: normalizedListings.length,
    saved: errors.length === 0 ? normalizedListings.length : 0,
    queued: 0,
    errors
  };
}

export async function bootstrapExistingListings() {
  return bootstrapExistingListingsWithDependencies({
    etsy: { getAllActiveListings },
    listingsRepository: createListingsRepository(),
    settingsRepository: createAppSettingsRepository()
  });
}
