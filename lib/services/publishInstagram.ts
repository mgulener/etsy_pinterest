import { getOptionalNumber } from "@/lib/config/env";
import { createInstagramPost } from "@/lib/instagram/posts";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { logger } from "@/lib/utils/logger";
import type {
  InstagramPublisher,
  InstagramPublisherPostsRepository,
  InstagramPublisherQueueRepository
} from "./types";

export type PublishInstagramResult = {
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

function getInstagramDryRun() {
  if (process.env.INSTAGRAM_DRY_RUN) {
    return process.env.INSTAGRAM_DRY_RUN === "true";
  }

  return process.env.DRY_RUN === "true";
}

export async function publishInstagramWithDependencies(input: {
  queueRepository: InstagramPublisherQueueRepository;
  postsRepository: InstagramPublisherPostsRepository;
  instagram: InstagramPublisher;
  maxPostsPerRun: number;
  maxRetries: number;
  dryRun: boolean;
}): Promise<PublishInstagramResult> {
  const pendingItems = await input.queueRepository.listPending(input.maxPostsPerRun);
  let claimed = 0;
  let published = 0;
  let skippedDuplicates = 0;
  let failed = 0;
  let retried = 0;
  const errors: PublishInstagramResult["errors"] = [];

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
        logger.info("DRY RUN", "Would publish Instagram post", {
          etsyListingId: item.etsy_listing_id,
          title: item.title
        });
        await input.queueRepository.markPendingAfterDryRun(item.id);
        continue;
      }

      const post = await input.instagram.createPost({
        imageUrl: item.image_url,
        caption: item.caption
      });

      await input.postsRepository.createPost({
        etsyListingId: item.etsy_listing_id,
        etsyImageId: item.etsy_image_id,
        instagramMediaId: post.id,
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

      if (nextAttemptCount >= input.maxRetries) {
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

export async function publishInstagram() {
  return publishInstagramWithDependencies({
    queueRepository: createInstagramQueueRepository(),
    postsRepository: createInstagramPostsRepository(),
    instagram: { createPost: createInstagramPost },
    maxPostsPerRun: getOptionalNumber("MAX_INSTAGRAM_POSTS_PER_RUN", 5),
    maxRetries: getOptionalNumber("MAX_INSTAGRAM_RETRIES", 3),
    dryRun: getInstagramDryRun()
  });
}
