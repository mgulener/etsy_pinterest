import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { publishInstagramPosts } from "@/lib/services/publishInstagramPosts";
import { logger } from "@/lib/utils/logger";

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Instagram publish error";
}

export async function runInstagramPublishJob(jobId: string, userId: string) {
  const jobsRepository = createSyncJobsRepository();
  const claimed = await jobsRepository.claimQueued(jobId);

  if (!claimed) {
    logger.info("INSTAGRAM_PUBLISH_JOB", "Instagram publish job is already claimed or complete", { jobId });
    return;
  }

  try {
    await jobsRepository.updateProgress(jobId, {
      current: 5,
      total: 100,
      message: "Reading Instagram publish settings"
    });

    const result = await publishInstagramPosts((progress) => jobsRepository.updateProgress(jobId, progress));

    await jobsRepository.complete(
      jobId,
      result,
      `Instagram publish finished. Selected ${result.selected}, claimed ${result.claimed}, published ${result.published}, retried ${result.retried}, failed ${result.failed}, dry run ${result.dryRun}.`
    );
  } catch (error) {
    const message = toErrorMessage(error);
    logger.error("INSTAGRAM_PUBLISH_JOB", "Instagram publish job failed", { jobId, message, userId });
    await jobsRepository.fail(jobId, message);
  }
}
