import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { syncEtsyListingsForUser } from "@/lib/services/syncEtsyListings";
import { logger } from "@/lib/utils/logger";

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Etsy sync error";
}

export async function runEtsySyncJob(jobId: string, userId: string) {
  const jobsRepository = createSyncJobsRepository();
  const claimed = await jobsRepository.claimQueued(jobId);

  if (!claimed) {
    logger.info("SYNC_JOB", "Sync job is already claimed or complete", { jobId });
    return;
  }

  try {
    const result = await syncEtsyListingsForUser(
      userId,
      (progress) => jobsRepository.updateProgress(jobId, progress),
      claimed.sync_limit ?? undefined
    );

    await jobsRepository.complete(
      jobId,
      result,
      `Etsy sync finished. Fetched ${result.fetched}, known ${result.known}, Pinterest queued ${result.queued}, Instagram queued ${result.instagramQueued}, errors ${result.errors.length}.`
    );
  } catch (error) {
    const message = toErrorMessage(error);
    logger.error("SYNC_JOB", "Sync job failed", { jobId, message });
    await jobsRepository.fail(jobId, message);
  }
}
