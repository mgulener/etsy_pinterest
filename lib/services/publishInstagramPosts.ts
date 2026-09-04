import { getCurrentUserSettings } from "@/lib/repositories/userSettingsRepository";
import { createInstagramPost } from "@/lib/instagram/posts";
import { InstagramApiError } from "@/lib/instagram/types";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { logger } from "@/lib/utils/logger";
import type {
  InstagramPublisher,
  InstagramPublisherPostsRepository,
  InstagramPublisherQueueRepository
} from "./types";

export type PublishInstagramPostsResult = {
  mode: "publish-instagram";
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
  return error instanceof Error ? error.message : "Unknown Instagram publishing error";
}

function shouldRetryError(error: unknown) {
  return error instanceof InstagramApiError ? error.retryable : true;
}


export async function publishInstagramPostsWithDependencies(input: {
  queueRepository: InstagramPublisherQueueRepository;
  postsRepository: InstagramPublisherPostsRepository;
  instagram: InstagramPublisher;
  maxPostsPerRun: number;
  maxRetries: number;
  dryRun: boolean;
}): Promise<PublishInstagramPostsResult> {
  const pendingItems = await input.queueRepository.listPending(input.maxPostsPerRun);
  let claimed = 0;
  let published = 0;
  let skippedDuplicates = 0;
  let failed = 0;
  let retried = 0;
  const errors: PublishInstagramPostsResult["errors"] = [];

  for (const pendingItem of pendingItems) {
    const item = await input.queueRepository.claimPending(pendingItem.id);

    if (!item) {
      logger.warn("INSTAGRAM_QUEUE", "Queue item was already claimed", {
        queueItemId: pendingItem.id
      });
      continue;
    }

    claimed += 1;
    logger.info("INSTAGRAM_QUEUE", "Processing queue item", {
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
        logger.warn(
          "INSTAGRAM_QUEUE",
          "Instagram post already exists; queue marked published",
          { etsyListingId: item.etsy_listing_id }
        );
        continue;
      }

      if (!item.image_url) {
        throw new Error("Queue item is missing image_url");
      }

      if (input.dryRun) {
        logger.info("DRY RUN][INSTAGRAM", "Would publish Instagram post", {
          etsyListingId: item.etsy_listing_id,
          image: item.image_url,
          caption: item.caption,
          mode: item.post_mode
        });
        await input.queueRepository.markPendingAfterDryRun(item.id);
        continue;
      }

      const post = await input.instagram.createPost({
        imageUrl: item.image_url,
        imageUrls: Array.isArray(item.media_urls)
          ? item.media_urls.filter((url): url is string => typeof url === "string")
          : [],
        caption: item.caption,
        mode: item.post_mode
      });

      await input.postsRepository.createPost({
        etsyListingId: item.etsy_listing_id,
        etsyImageId: item.etsy_image_id,
        instagramMediaId: post.id,
        instagramCreationId: post.creationId,
        mediaType: post.mediaType,
        caption: item.caption,
        instagramPermalink: post.permalink
      });

      await input.queueRepository.markPublished(item.id);
      published += 1;
      logger.info("INSTAGRAM", "Post created", {
        etsyListingId: item.etsy_listing_id,
        instagramMediaId: post.id
      });
    } catch (error) {
      const message = toErrorMessage(error);
      const nextAttemptCount = item.attempt_count + 1;
      errors.push({ etsyListingId: item.etsy_listing_id, message });

      if (nextAttemptCount >= input.maxRetries || !shouldRetryError(error)) {
        await input.queueRepository.markFailed(item.id, message, nextAttemptCount);
        failed += 1;
        logger.error("INSTAGRAM_QUEUE", "Queue item failed permanently", {
          etsyListingId: item.etsy_listing_id,
          attemptCount: nextAttemptCount,
          message
        });
      } else {
        await input.queueRepository.markRetryable(item.id, message, nextAttemptCount);
        retried += 1;
        logger.warn("INSTAGRAM_QUEUE", "Queue item returned to pending for retry", {
          etsyListingId: item.etsy_listing_id,
          attemptCount: nextAttemptCount,
          message
        });
      }
    }
  }

  return {
    mode: "publish-instagram",
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

export async function publishInstagramPosts() {
  const settings = await getCurrentUserSettings();

  if (!settings.instagramEnabled) {
    return {
      mode: "publish-instagram",
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

  return publishInstagramPostsWithDependencies({
    queueRepository: createInstagramQueueRepository(),
    postsRepository: createInstagramPostsRepository(),
    instagram: { createPost: createInstagramPost },
    maxPostsPerRun: settings.maxInstagramPostsPerRun,
    maxRetries: settings.maxInstagramRetries,
    dryRun: settings.dryRun
  });
}
