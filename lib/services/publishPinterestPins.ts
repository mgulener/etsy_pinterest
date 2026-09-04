import { getCurrentUserSettings } from "@/lib/repositories/userSettingsRepository";
import { createPin } from "@/lib/pinterest/pins";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { createPinterestPostsRepository } from "@/lib/repositories/pinterestPostsRepository";
import { logger } from "@/lib/utils/logger";
import type {
  PinterestPublisher,
  PublisherPostsRepository,
  PublisherQueueRepository
} from "./types";

export type PublishPinterestPinsResult = {
  mode: "publish";
  selected: number;
  claimed: number;
  published: number;
  skippedDuplicates: number;
  failed: number;
  retried: number;
  dryRun: boolean;
  errors: Array<{ etsyListingId: number; message: string }>;
};

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Pinterest publishing error";
}

export async function publishPinterestPinsWithDependencies(input: {
  queueRepository: PublisherQueueRepository;
  postsRepository: PublisherPostsRepository;
  pinterest: PinterestPublisher;
  maxPinsPerRun: number;
  maxRetries: number;
  dryRun: boolean;
}): Promise<PublishPinterestPinsResult> {
  const pendingItems = await input.queueRepository.listPending(input.maxPinsPerRun);
  let claimed = 0;
  let published = 0;
  let skippedDuplicates = 0;
  let failed = 0;
  let retried = 0;
  const errors: PublishPinterestPinsResult["errors"] = [];

  for (const pendingItem of pendingItems) {
    const item = await input.queueRepository.claimPending(pendingItem.id);

    if (!item) {
      logger.warn("QUEUE", "Queue item was already claimed", {
        queueItemId: pendingItem.id
      });
      continue;
    }

    claimed += 1;
    logger.info("QUEUE", "Processing queue item", {
      etsyListingId: item.etsy_listing_id,
      attemptCount: item.attempt_count
    });

    try {
      const existingPost = await input.postsRepository.findByEtsyListingId(
        item.etsy_listing_id
      );

      if (existingPost) {
        await input.queueRepository.markPublished(item.id);
        skippedDuplicates += 1;
        logger.warn("QUEUE", "Pinterest post already exists; queue marked published", {
          etsyListingId: item.etsy_listing_id
        });
        continue;
      }

      if (!item.image_url || !item.destination_url) {
        throw new Error("Queue item is missing image_url or destination_url");
      }

      const description = item.description || item.title;

      if (input.dryRun) {
        logger.info("DRY RUN", "Would publish Pinterest pin", {
          etsyListingId: item.etsy_listing_id,
          title: item.title,
          boardId: item.board_id
        });
        await input.queueRepository.markPendingAfterDryRun(item.id);
        continue;
      }

      const pin = await input.pinterest.createPin({
        boardId: item.board_id,
        imageUrl: item.image_url,
        title: item.title,
        description,
        destinationUrl: item.destination_url
      });

      await input.postsRepository.createPost({
        etsyListingId: item.etsy_listing_id,
        etsyImageId: item.etsy_image_id,
        pinterestPinId: pin.id,
        pinterestBoardId: item.board_id
      });

      await input.queueRepository.markPublished(item.id);
      published += 1;
      logger.info("PINTEREST", "Pin created", {
        etsyListingId: item.etsy_listing_id,
        pinterestPinId: pin.id
      });
    } catch (error) {
      const message = toErrorMessage(error);
      const nextAttemptCount = item.attempt_count + 1;
      errors.push({ etsyListingId: item.etsy_listing_id, message });

      if (nextAttemptCount >= input.maxRetries) {
        await input.queueRepository.markFailed(item.id, message, nextAttemptCount);
        failed += 1;
        logger.error("QUEUE", "Queue item failed permanently", {
          etsyListingId: item.etsy_listing_id,
          attemptCount: nextAttemptCount,
          message
        });
      } else {
        await input.queueRepository.markRetryable(item.id, message, nextAttemptCount);
        retried += 1;
        logger.warn("QUEUE", "Queue item returned to pending for retry", {
          etsyListingId: item.etsy_listing_id,
          attemptCount: nextAttemptCount,
          message
        });
      }
    }
  }

  return {
    mode: "publish",
    selected: pendingItems.length,
    claimed,
    published,
    skippedDuplicates,
    failed,
    retried,
    dryRun: input.dryRun,
    errors
  };
}

export async function publishPinterestPins() {
  const settings = await getCurrentUserSettings();

  if (!settings.pinterestEnabled) {
    return {
      mode: "publish",
      selected: 0,
      claimed: 0,
      published: 0,
      skippedDuplicates: 0,
      failed: 0,
      retried: 0,
      dryRun: settings.dryRun,
      errors: []
    };
  }

  return publishPinterestPinsWithDependencies({
    queueRepository: createPinQueueRepository(),
    postsRepository: createPinterestPostsRepository(),
    pinterest: { createPin },
    maxPinsPerRun: settings.maxPinsPerRun,
    maxRetries: settings.maxPinRetries,
    dryRun: settings.dryRun
  });
}
