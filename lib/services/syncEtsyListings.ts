import { getAllActiveListings } from "@/lib/etsy/client";
import { normalizeEtsyListing } from "@/lib/etsy/listings";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import { getCurrentUserSettings, getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { generateInstagramCaptionWithAI } from "@/lib/instagram/aiCaption";
import { buildScheduledAt, sortListingsForQueue } from "@/lib/queue/scheduling";
import { logger } from "@/lib/utils/logger";
import type {
  BootstrapSettingsRepository,
  EtsyListingsSource,
  InstagramSyncQueueRepository,
  SyncListingsRepository,
  SyncQueueRepository
} from "./types";

export type SyncProgress = {
  current: number;
  total?: number;
  message: string;
};

export type SyncEtsyListingsResult = {
  mode: "sync";
  fetched: number;
  known: number;
  created: number;
  queued: number;
  instagramQueued: number;
  skippedBecauseBootstrapRequired: boolean;
  errors: Array<{ etsyListingId: number; message: string }>;
};

export async function syncEtsyListingsWithDependencies(input: {
  etsy: EtsyListingsSource;
  listingsRepository: SyncListingsRepository;
  queueRepository?: SyncQueueRepository;
  instagramQueueRepository?: InstagramSyncQueueRepository;
  settingsRepository: BootstrapSettingsRepository;
  boardId?: string;
  onProgress?: (progress: SyncProgress) => Promise<void> | void;
  instagramCaptionGenerator?: (listing: NormalizedEtsyListing) => Promise<string>;
}): Promise<SyncEtsyListingsResult> {
  const reportProgress = async (progress: SyncProgress) => {
    try {
      await input.onProgress?.(progress);
    } catch (error) {
      logger.warn("SYNC", "Progress update failed; sync will continue", {
        message: error instanceof Error ? error.message : "Unknown progress update error"
      });
    }
  };

  const initialSyncCompleted = await input.settingsRepository.isInitialSyncCompleted();

  if (!initialSyncCompleted) {
    await reportProgress({ current: 100, message: "Initial sync required; sync skipped" });
    logger.warn("SYNC", "Initial sync is not completed; normal sync skipped");
    return {
      mode: "sync",
      fetched: 0,
      known: 0,
      created: 0,
      queued: 0,
      instagramQueued: 0,
      skippedBecauseBootstrapRequired: true,
      errors: []
    };
  }

  await reportProgress({ current: 10, message: "Fetching Etsy listings" });
  const etsyListings = await input.etsy.getAllActiveListings();
  await reportProgress({ current: 35, message: `Fetched ${etsyListings.length} Etsy listings` });
  const normalizedListings = etsyListings.map(normalizeEtsyListing);
  const existingIds = await input.listingsRepository.getExistingEtsyListingIds(
    normalizedListings.map((listing) => listing.etsyListingId)
  );
  await reportProgress({ current: 45, message: "Comparing known and new listings" });

  const known = existingIds.size;
  const knownListings = normalizedListings.filter((listing) => existingIds.has(listing.etsyListingId));
  const newListings = sortListingsForQueue(normalizedListings.filter(
    (listing) => !existingIds.has(listing.etsyListingId)
  ));
  await reportProgress({ current: 50, message: "Saving Etsy listings" });
  await input.listingsRepository.upsertKnownListings(knownListings);
  let created = 0;
  let queued = 0;
  let instagramQueued = 0;
  const errors: SyncEtsyListingsResult["errors"] = [];

  logger.info("SYNC", "Listings compared with database", {
    fetched: normalizedListings.length,
    known,
    new: newListings.length
  });

  const scheduleStart = new Date();

  for (const [index, listing] of newListings.entries()) {
    const scheduledAt = buildScheduledAt(index, undefined, scheduleStart);
    const queueProgress = newListings.length === 0
      ? 95
      : 55 + Math.round((index / newListings.length) * 40);
    await reportProgress({
      current: queueProgress,
      message: `Queueing new listing ${index + 1} of ${newListings.length}`
    });
    const errorCountBeforeQueueing = errors.length;

    if (input.queueRepository && input.boardId) {
      try {
        const queueResult = await input.queueRepository.enqueueListing(
          listing,
          input.boardId,
          { scheduledAt }
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

    if (input.instagramQueueRepository) {
      try {
        let caption: string | undefined;
        let captionSource: "rule" | "ai" | undefined;

        if (input.instagramCaptionGenerator) {
          await reportProgress({
            current: queueProgress,
            message: `Generating AI caption for new listing ${index + 1} of ${newListings.length}`
          });
          caption = await input.instagramCaptionGenerator(listing);
          captionSource = "ai";
        }

        const instagramQueueResult =
          await input.instagramQueueRepository.enqueueListing(listing, {
            caption,
            captionSource,
            scheduledAt
          });

        if (instagramQueueResult === "created") {
          instagramQueued += 1;
        }

        logger.info("SYNC", "New listing queued for Instagram", {
          etsyListingId: listing.etsyListingId,
          queueResult: instagramQueueResult
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown Instagram listing sync error";
        errors.push({ etsyListingId: listing.etsyListingId, message });
        logger.error("SYNC", "Instagram listing sync failed", {
          etsyListingId: listing.etsyListingId,
          message
        });
      }
    }

    if (errors.length === errorCountBeforeQueueing) {
      try {
        await input.listingsRepository.upsertKnownListing(listing);
        created += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown listing save error";
        errors.push({ etsyListingId: listing.etsyListingId, message });
        logger.error("SYNC", "New listing could not be marked as known", {
          etsyListingId: listing.etsyListingId,
          message
        });
      }
    }
  }

  if (queued > 0 && input.queueRepository?.rebuildPendingSchedule) {
    await reportProgress({ current: 96, message: "Prioritizing the Pinterest queue" });
    await input.queueRepository.rebuildPendingSchedule();
  }

  if (instagramQueued > 0 && input.instagramQueueRepository?.rebuildPendingSchedule) {
    await reportProgress({ current: 97, message: "Prioritizing the Instagram queue" });
    await input.instagramQueueRepository.rebuildPendingSchedule();
  }

  await reportProgress({ current: 98, message: "Finalizing Etsy sync" });

  return {
    mode: "sync",
    fetched: normalizedListings.length,
    known,
    created,
    queued,
    instagramQueued,
    skippedBecauseBootstrapRequired: false,
    errors
  };
}

export async function syncEtsyListingsForUser(
  userId: string,
  onProgress?: (progress: SyncProgress) => Promise<void> | void,
  maxListings?: number
) {
  const settings = await getSettingsForUser(userId);
  const pinterestEnabled = Boolean(settings.pinterestEnabled && settings.pinterestBoardId);
  const instagramEnabled = Boolean(
    settings.instagramEnabled &&
      settings.instagramAccessToken &&
      (settings.instagramAccountId || settings.instagramUserId)
  );

  return syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: () => getAllActiveListings(userId, maxListings) },
    listingsRepository: createListingsRepository(),
    queueRepository: pinterestEnabled ? createPinQueueRepository() : undefined,
    instagramQueueRepository: instagramEnabled
      ? createInstagramQueueRepository()
      : undefined,
    settingsRepository: createAppSettingsRepository(),
    boardId: pinterestEnabled ? settings.pinterestBoardId ?? undefined : undefined,
    onProgress,
    instagramCaptionGenerator: settings.aiCaptionsEnabled && settings.openaiApiKey
      ? (listing) => generateInstagramCaptionWithAI({
          listing,
          apiKey: settings.openaiApiKey,
          model: settings.openaiModel
        })
      : undefined
  });
}

export async function syncEtsyListings(
  onProgress?: (progress: SyncProgress) => Promise<void> | void,
  maxListings?: number
) {
  const settings = await getCurrentUserSettings();
  const pinterestEnabled = Boolean(settings.pinterestEnabled && settings.pinterestBoardId);
  const instagramEnabled = Boolean(
    settings.instagramEnabled &&
      settings.instagramAccessToken &&
      (settings.instagramAccountId || settings.instagramUserId)
  );

  return syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: () => getAllActiveListings(undefined, maxListings) },
    listingsRepository: createListingsRepository(),
    queueRepository: pinterestEnabled ? createPinQueueRepository() : undefined,
    instagramQueueRepository: instagramEnabled
      ? createInstagramQueueRepository()
      : undefined,
    settingsRepository: createAppSettingsRepository(),
    boardId: pinterestEnabled ? settings.pinterestBoardId ?? undefined : undefined,
    onProgress,
    instagramCaptionGenerator: settings.aiCaptionsEnabled && settings.openaiApiKey
      ? (listing) => generateInstagramCaptionWithAI({
          listing,
          apiKey: settings.openaiApiKey,
          model: settings.openaiModel
        })
      : undefined
  });
}
