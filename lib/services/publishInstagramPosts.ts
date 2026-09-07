import { getCurrentUserSettings, getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { createDurableInstagramPublisher, InstagramVerificationRequired } from "@/lib/instagram/durablePublishing";
import { createInstagramPublishAttemptsRepository } from "@/lib/repositories/instagramPublishAttemptsRepository";
import { prepareInstagramContainer, waitForContainer, publishMedia, getContainerStatus, getMedia } from "@/lib/instagram/publishing";
import { InstagramApiError } from "@/lib/instagram/types";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { buildScheduledAt } from "@/lib/queue/scheduling";
import type { SyncJobProgressInput } from "@/lib/repositories/syncJobsRepository";
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
  recovered: number;
  failed: number;
  retried: number;
  needsReview: number;
  dryRun: boolean;
  errors: Array<{ etsyListingId: number; message: string }>;
};

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Instagram publishing error";
}

function shouldRetryError(error: unknown) {
  return error instanceof InstagramApiError ? error.retryable : true;
}

const STALE_PROCESSING_MS = 10 * 60_000;

export async function publishInstagramPostsWithDependencies(input: {
  queueRepository: InstagramPublisherQueueRepository;
  postsRepository: InstagramPublisherPostsRepository;
  instagram: InstagramPublisher;
  maxPostsPerRun: number;
  maxRetries: number;
  dryRun: boolean;
  onProgress?: (progress: SyncJobProgressInput) => Promise<void> | void;
}): Promise<PublishInstagramPostsResult> {
  await input.onProgress?.({ current: 10, total: 100, message: "Recovering stale Instagram publish items" });
  const recovered = await input.queueRepository.recoverStaleProcessing(
    new Date(Date.now() - STALE_PROCESSING_MS).toISOString(),
    buildScheduledAt(1)
  );

  await input.onProgress?.({
    current: 20,
    total: 100,
    message: recovered > 0
      ? `Recovered ${recovered} stale Instagram items. Reading pending queue.`
      : "Reading pending Instagram queue"
  });
  const pendingItems = await input.queueRepository.listPending(input.maxPostsPerRun);
  const progressTotal = Math.max(pendingItems.length, 1);
  let claimed = 0;
  let published = 0;
  let skippedDuplicates = 0;
  let failed = 0;
  let retried = 0;
  let needsReview = 0;
  const errors: PublishInstagramPostsResult["errors"] = [];

  for (const [index, pendingItem] of pendingItems.entries()) {
    await input.onProgress?.({
      current: index,
      total: progressTotal,
      message: `Claiming Instagram queue item ${index + 1} of ${pendingItems.length}`
    });

    const item = await input.queueRepository.claimPending(pendingItem.id);

    if (!item) {
      logger.warn("INSTAGRAM_QUEUE", "Queue item was already claimed", {
        queueItemId: pendingItem.id
      });
      continue;
    }

    claimed += 1;
    await input.onProgress?.({
      current: index,
      total: progressTotal,
      message: `Preparing Instagram post ${index + 1} of ${pendingItems.length}: ${item.title.slice(0, 80)}`
    });
    logger.info("INSTAGRAM_QUEUE", "Processing queue item", {
      etsyListingId: item.etsy_listing_id,
      attemptCount: item.attempt_count
    });

    let remotePostCreated = false;
    try {
      const existingPost = await input.postsRepository.findByEtsyListingId(
        item.etsy_listing_id
      );

      if (existingPost) {
        await input.onProgress?.({ current: index, total: progressTotal, message: `Existing Instagram post found for ${item.title.slice(0, 80)}` });
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

      await input.onProgress?.({ current: index, total: progressTotal, message: `Publishing Instagram post: ${item.title.slice(0, 80)}` });
      const post = await input.instagram.createPost({
        imageUrl: item.image_url,
        imageUrls: Array.isArray(item.media_urls)
          ? item.media_urls.filter((url): url is string => typeof url === "string")
          : [],
        caption: item.caption,
        mode: item.post_mode
      }, item.etsy_listing_id);
      remotePostCreated = true;

      await input.postsRepository.createPost({
        etsyListingId: item.etsy_listing_id,
        etsyImageId: item.etsy_image_id,
        instagramMediaId: post.id,
        instagramCreationId: post.creationId,
        mediaType: post.mediaType,
        caption: post.caption ?? item.caption,
        instagramPermalink: post.permalink
      });

      await input.queueRepository.markPublished(item.id);
      published += 1;
      await input.onProgress?.({
        current: index + 1,
        total: progressTotal,
        message: `Published ${published} of ${pendingItems.length}; retried ${retried}; failed ${failed}`
      });
      logger.info("INSTAGRAM", "Post created", {
        etsyListingId: item.etsy_listing_id,
        instagramMediaId: post.id
      });
    } catch (error) {
      const message = toErrorMessage(error);
      const nextAttemptCount = item.attempt_count + 1;
      errors.push({ etsyListingId: item.etsy_listing_id, message });

      if (remotePostCreated || error instanceof InstagramVerificationRequired) {
        await input.queueRepository.markNeedsReview(item.id, message);
        needsReview += 1;
        continue;
      }

      if (nextAttemptCount >= input.maxRetries || !shouldRetryError(error)) {
        await input.queueRepository.markFailed(item.id, message, nextAttemptCount);
        failed += 1;
        await input.onProgress?.({
          current: index + 1,
          total: progressTotal,
          message: `Instagram item failed permanently: ${item.title.slice(0, 80)}`
        });
        logger.error("INSTAGRAM_QUEUE", "Queue item failed permanently", {
          etsyListingId: item.etsy_listing_id,
          attemptCount: nextAttemptCount,
          message
        });
      } else {
        await input.queueRepository.markRetryable(item.id, message, nextAttemptCount, buildScheduledAt(1));
        retried += 1;
        await input.onProgress?.({
          current: index + 1,
          total: progressTotal,
          message: `Instagram item will retry in the next slot: ${item.title.slice(0, 80)}`
        });
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
    recovered,
    failed,
    retried,
    needsReview,
    dryRun: input.dryRun,
    errors
  };
}

export async function publishInstagramPosts(
  onProgress?: (progress: SyncJobProgressInput) => Promise<void> | void,
  userId?: string | null
) {
  const settings = userId ? await getSettingsForUser(userId) : await getCurrentUserSettings();

  await onProgress?.({ current: 15, total: 100, message: "Checking Instagram settings" });

  if (!settings.instagramEnabled) {
    return {
      mode: "publish-instagram",
      selected: 0,
      claimed: 0,
      published: 0,
      skippedDuplicates: 0,
      recovered: 0,
      failed: 0,
      retried: 0,
      needsReview: 0,
      dryRun: settings.dryRun,
      errors: []
    };
  }

  const publisher = getDurableInstagramPublisher(settings, userId);
  return publishInstagramPostsWithDependencies({
    queueRepository: createInstagramQueueRepository(),
    postsRepository: createInstagramPostsRepository(),
    instagram: {
      createPost: (postInput, listingId) => publisher.create(listingId, postInput)
    },
    maxPostsPerRun: settings.maxInstagramPostsPerRun,
    maxRetries: settings.maxInstagramRetries,
    dryRun: settings.dryRun,
    onProgress
  });
}

export function getDurableInstagramPublisher(settings: Awaited<ReturnType<typeof getSettingsForUser>>, userId?: string | null) {
  const owner = settings.userId ?? userId;
  const accountId = settings.instagramAccountId || settings.instagramUserId;
  if (!accountId || !owner) throw new Error("Instagram account and user are required for durable publishing.");
  return createDurableInstagramPublisher(createInstagramPublishAttemptsRepository(), {
    prepare: (input) => prepareInstagramContainer({ ...input, userId: owner }),
    wait: async (id) => {
      if ((await getContainerStatus(id, owner)).status_code === "PUBLISHED") {
        throw new InstagramVerificationRequired("Container is already published; media ID verification required.");
      }
      await waitForContainer(id, owner);
    },
    publish: (id) => publishMedia(id, owner),
    status: (id) => getContainerStatus(id, owner),
    media: (id) => getMedia(id, owner)
  }, accountId);
}
