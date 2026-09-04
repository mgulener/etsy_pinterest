import { generateInstagramCaptionWithAI } from "@/lib/instagram/aiCaption";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { InstagramPostMode } from "@/lib/instagram/types";
import type { SyncJobRow } from "@/lib/supabase/types";
import { logger } from "@/lib/utils/logger";

const TARGET_STATUSES = ["pending", "failed", "cancelled"] as const;
const BATCH_SIZE = 25;
const MAX_CONSECUTIVE_FAILURES = 5;

type QueueItem = {
  id: string;
  title: string;
  description: string | null;
  destination_url: string | null;
  post_mode: InstagramPostMode;
  media_urls: unknown;
};

type AiCaptionJobResult = {
  selected: number;
  generated: number;
  failed: number;
  errors: Array<{ id: string; title: string; message: string }>;
};

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown AI caption error";
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string")
    : [];
}

function getJobResult(job: SyncJobRow): AiCaptionJobResult {
  if (job.result && typeof job.result === "object" && !Array.isArray(job.result)) {
    const result = job.result as Record<string, unknown>;

    return {
      selected: Number(result.selected ?? 0),
      generated: Number(result.generated ?? 0),
      failed: Number(result.failed ?? 0),
      errors: Array.isArray(result.errors)
        ? result.errors.filter((item): item is AiCaptionJobResult["errors"][number] => (
            typeof item === "object" &&
            item !== null &&
            "id" in item &&
            "title" in item &&
            "message" in item
          )).slice(0, 25)
        : []
    };
  }

  return { selected: 0, generated: 0, failed: 0, errors: [] };
}

async function updateQueueCaption(item: QueueItem, caption: string) {
  const { error } = await getSupabaseAdmin()
    .from("instagram_queue")
    .update({
      caption: caption.slice(0, 2200),
      caption_source: "ai",
      caption_generated_at: new Date().toISOString(),
      media_urls: getStringArray(item.media_urls),
      last_error: null
    })
    .eq("id", item.id)
    .in("status", [...TARGET_STATUSES]);

  if (error) {
    throw new Error(`Failed to update AI caption for ${item.id}: ${error.message}`);
  }
}

async function markCaptionError(item: QueueItem, message: string) {
  const { error } = await getSupabaseAdmin()
    .from("instagram_queue")
    .update({ last_error: `AI caption failed: ${message.slice(0, 240)}` })
    .eq("id", item.id)
    .in("status", [...TARGET_STATUSES]);

  if (error) {
    throw new Error(`Failed to store AI caption error for ${item.id}: ${error.message}`);
  }
}

async function getTargetItems(limit?: number | null) {
  const pageSize = 500;
  const items: QueueItem[] = [];
  let from = 0;

  while (!limit || items.length < limit) {
    const remaining = limit ? limit - items.length : pageSize;
    const to = from + Math.min(pageSize, remaining) - 1;
    const { data, error } = await getSupabaseAdmin()
      .from("instagram_queue")
      .select("id, title, description, destination_url, post_mode, media_urls")
      .in("status", [...TARGET_STATUSES])
      .order("created_at", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read Instagram queue for AI captions: ${error.message}`);
    }

    const rows = (data ?? []) as QueueItem[];
    items.push(...rows);

    if (rows.length < pageSize || (limit && items.length >= limit)) {
      break;
    }

    from += pageSize;
  }

  return limit ? items.slice(0, limit) : items;
}

export async function runInstagramAiCaptionJob(jobId: string, userId: string) {
  const jobsRepository = createSyncJobsRepository();
  const claimed = await jobsRepository.claimQueued(jobId);

  if (!claimed) {
    logger.info("AI_CAPTION_JOB", "AI caption job is already claimed or complete", { jobId });
    return;
  }

  try {
    const settings = await getSettingsForUser(userId);

    if (!settings.aiCaptionsEnabled) {
      throw new Error("AI captions are disabled. Enable them in Settings first.");
    }

    if (!settings.openaiApiKey) {
      throw new Error("OpenAI API key is missing. Add it in Settings before generating AI captions.");
    }

    const items = await getTargetItems(claimed.sync_limit);
    const total = Math.max(items.length, 1);
    const startIndex = Math.min(Math.max(claimed.progress_current, 0), items.length);
    const endIndex = Math.min(startIndex + BATCH_SIZE, items.length);
    const result = { ...getJobResult(claimed), selected: items.length };
    let consecutiveFailures = 0;

    await jobsRepository.updateProgress(jobId, {
      current: startIndex,
      total,
      message: `Generating AI captions ${startIndex + 1}-${endIndex} of ${items.length}`
    });

    for (let index = startIndex; index < endIndex; index += 1) {
      const item = items[index];

      await jobsRepository.updateProgress(jobId, {
        current: index,
        total,
        message: `Generating AI caption ${index + 1} of ${items.length}: ${item.title.slice(0, 80)}`
      });

      try {
        const caption = await generateInstagramCaptionWithAI({
          listing: {
            title: item.title,
            description: item.description,
            destinationUrl: item.destination_url
          },
          apiKey: settings.openaiApiKey,
          model: settings.openaiModel
        });

        await updateQueueCaption(item, caption);
        result.generated += 1;
        consecutiveFailures = 0;
      } catch (error) {
        const message = toErrorMessage(error);
        result.failed += 1;
        result.errors = [
          ...result.errors,
          { id: item.id, title: item.title, message }
        ].slice(-25);
        consecutiveFailures += 1;
        await markCaptionError(item, message);

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`AI caption generation stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Last error: ${message}`);
        }
      }

      await jobsRepository.updateProgress(jobId, {
        current: index + 1,
        total,
        message: `Generated ${result.generated} AI captions, ${result.failed} failed`
      });
    }

    if (endIndex >= items.length) {
      await jobsRepository.complete(
        jobId,
        result,
        `AI captions finished. Generated ${result.generated} of ${items.length}; failed ${result.failed}.`
      );
      return;
    }

    await jobsRepository.requeue(
      jobId,
      {
        current: endIndex,
        total,
        message: `AI captions paused at ${endIndex} of ${items.length}. Continuing with next batch.`
      },
      result
    );
  } catch (error) {
    const message = toErrorMessage(error);
    logger.error("AI_CAPTION_JOB", "AI caption job failed", { jobId, message });
    await jobsRepository.fail(jobId, message);
  }
}
