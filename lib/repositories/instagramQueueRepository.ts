import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import {
  getInstagramPostMode,
  resolveAvailableInstagramMediaUrls,
  resolveInstagramMediaUrls,
  selectInstagramMediaUrls
} from "@/lib/instagram/media";
import { buildInstagramCaption } from "@/lib/instagram/caption";
import { buildScheduledAt, DEFAULT_QUEUE_INTERVAL_MINUTES, sortQueueRowsForPublishing } from "@/lib/queue/scheduling";
import type { InstagramPostMode } from "@/lib/instagram/types";
import type { InstagramQueueRow, PinQueueStatus } from "@/lib/supabase/types";

export type InstagramQueuePageResult = {
  rows: InstagramQueueRow[];
  total: number;
};

export type InstagramQueueRepository = {
  countByStatus(status: PinQueueStatus): Promise<number>;
  enqueueListing(listing: NormalizedEtsyListing, options?: {
    caption?: string;
    captionSource?: "rule" | "ai";
    scheduledAt?: string;
  }): Promise<"created" | "duplicate">;
  updateDetails(input: {
    id: string;
    caption: string;
    postMode: InstagramPostMode;
    selectedMediaUrls?: string[];
    scheduledAt?: string;
    captionSource?: "manual" | "ai";
  }): Promise<void>;
  updateSchedule(id: string, scheduledAt: string): Promise<void>;
  rebuildPendingSchedule(intervalMinutes?: number): Promise<number>;
  listPending(limit: number): Promise<InstagramQueueRow[]>;
  claimPending(id: string): Promise<InstagramQueueRow | null>;
  markPublished(id: string): Promise<void>;
  markRetryable(id: string, error: string, attemptCount: number, retryScheduledAt: string): Promise<void>;
  markFailed(id: string, error: string, attemptCount: number): Promise<void>;
  markPendingAfterDryRun(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  retryAllFailed(): Promise<void>;
  cancel(id: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(params: {
    page: number;
    pageSize: number;
    status?: PinQueueStatus;
    search?: string;
  }): Promise<InstagramQueuePageResult>;
};

async function resolvePostMode(listing: NormalizedEtsyListing): Promise<InstagramPostMode> {
  const configuredMode = await getInstagramPostMode();
  const mediaUrls = resolveInstagramMediaUrls(listing, configuredMode);

  return configuredMode === "carousel" && mediaUrls.length > 1
    ? "carousel"
    : "single";
}

export function createInstagramQueueRepository(): InstagramQueueRepository {
  const supabase = getSupabaseAdmin();

  return {
    async countByStatus(status) {
      const { count, error } = await supabase
        .from("instagram_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status);

      if (error) {
        throw new Error(`Failed to count Instagram queue status ${status}: ${error.message}`);
      }

      return count ?? 0;
    },

    async enqueueListing(listing, options) {
      const postMode = await resolvePostMode(listing);
      const availableMediaUrls = resolveAvailableInstagramMediaUrls(listing);
      const mediaUrls = postMode === "carousel"
        ? selectInstagramMediaUrls(availableMediaUrls, postMode)
        : resolveInstagramMediaUrls(listing, postMode);
      const { error } = await supabase.from("instagram_queue").insert({
        etsy_listing_id: listing.etsyListingId,
        etsy_image_id: listing.etsyImageId,
        image_url: listing.imageUrl,
        title: listing.title,
        description: listing.description,
        destination_url: listing.destinationUrl,
        caption: options?.caption ?? buildInstagramCaption(listing),
        caption_source: options?.captionSource ?? "rule",
        caption_generated_at: options?.captionSource === "ai" ? new Date().toISOString() : null,
        post_mode: postMode,
        media_urls: mediaUrls,
        available_media_urls: availableMediaUrls,
        scheduled_at: options?.scheduledAt ?? new Date().toISOString(),
        schedule_locked: false
      });

      if (error?.code === "23505") {
        return "duplicate";
      }

      if (error) {
        throw new Error(`Failed to enqueue Instagram item ${listing.etsyListingId}: ${error.message}`);
      }

      return "created";
    },

    async updateDetails(input) {
      const { data: current, error: readError } = await supabase
        .from("instagram_queue")
        .select("media_urls, available_media_urls")
        .eq("id", input.id)
        .maybeSingle();

      if (readError) {
        throw new Error(`Failed to read Instagram queue item ${input.id}: ${readError.message}`);
      }

      const availableMediaUrls = Array.isArray(current?.available_media_urls)
        ? current.available_media_urls.filter((url): url is string => typeof url === "string")
        : Array.isArray(current?.media_urls)
          ? current.media_urls.filter((url): url is string => typeof url === "string")
          : [];
      const requestedMediaUrls = input.selectedMediaUrls?.filter((url) =>
        availableMediaUrls.includes(url)
      ) ?? [];
      const mediaUrls = requestedMediaUrls.length > 0
        ? selectInstagramMediaUrls(requestedMediaUrls, input.postMode, requestedMediaUrls.length)
        : selectInstagramMediaUrls(availableMediaUrls, input.postMode);
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          caption: input.caption.slice(0, 2200),
          caption_source: input.captionSource ?? "manual",
          caption_generated_at: input.captionSource === "ai" ? new Date().toISOString() : null,
          post_mode: input.postMode,
          media_urls: mediaUrls,
          available_media_urls: availableMediaUrls,
          ...(input.scheduledAt ? { scheduled_at: input.scheduledAt, schedule_locked: true } : {})
        })
        .eq("id", input.id)
        .in("status", ["pending", "failed", "cancelled"]);

      if (error) {
        throw new Error(`Failed to update Instagram queue item ${input.id}: ${error.message}`);
      }
    },

    async updateSchedule(id, scheduledAt) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({ scheduled_at: scheduledAt, schedule_locked: true })
        .eq("id", id)
        .in("status", ["pending", "failed", "cancelled"]);

      if (error) {
        throw new Error(`Failed to update Instagram queue schedule ${id}: ${error.message}`);
      }
    },

    async rebuildPendingSchedule(intervalMinutes = DEFAULT_QUEUE_INTERVAL_MINUTES) {
      const { data, error } = await supabase
        .from("instagram_queue")
        .select("id, title, description, created_at, scheduled_at")
        .eq("status", "pending")
        .eq("schedule_locked", false);

      if (error) {
        throw new Error(`Failed to read Instagram queue for schedule rebuild: ${error.message}`);
      }

      const rows = sortQueueRowsForPublishing(data ?? []);
      const startDate = new Date();

      const results = await Promise.all(rows.map((item, index) =>
        supabase
          .from("instagram_queue")
          .update({ scheduled_at: buildScheduledAt(index, intervalMinutes, startDate), schedule_locked: false })
          .eq("id", item.id)
      ));
      const updateError = results.find((result) => result.error)?.error;

      if (updateError) {
        throw new Error("Failed to rebuild Instagram queue schedule: " + updateError.message);
      }

      return rows.length;
    },

    async listPending(limit) {
      const { data, error } = await supabase
        .from("instagram_queue")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to read pending Instagram queue: ${error.message}`);
      }

      return data ?? [];
    },

    async claimPending(id) {
      const { data, error } = await supabase
        .from("instagram_queue")
        .update({
          status: "processing",
          last_error: null,
          processing_started_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to claim Instagram queue item ${id}: ${error.message}`);
      }

      return data;
    },

    async markPublished(id) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "published",
          processed_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to mark Instagram queue item ${id} as published: ${error.message}`);
      }
    },

    async markRetryable(id, errorMessage, attemptCount, retryScheduledAt) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "pending",
          attempt_count: attemptCount,
          last_error: errorMessage,
          processing_started_at: null,
          scheduled_at: retryScheduledAt,
          schedule_locked: false
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to return Instagram queue item ${id} to pending: ${error.message}`);
      }
    },

    async markFailed(id, errorMessage, attemptCount) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "failed",
          attempt_count: attemptCount,
          last_error: errorMessage,
          processing_started_at: null,
          processed_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to mark Instagram queue item ${id} as failed: ${error.message}`);
      }
    },

    async markPendingAfterDryRun(id) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "pending",
          last_error: null,
          processing_started_at: null
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to restore dry-run Instagram queue item ${id}: ${error.message}`);
      }
    },

    async retry(id) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "pending",
          attempt_count: 0,
          last_error: null,
          processed_at: null,
          processing_started_at: null,
          scheduled_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("status", "failed");

      if (error) {
        throw new Error(`Failed to retry Instagram queue item ${id}: ${error.message}`);
      }
    },

    async retryAllFailed() {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "pending",
          attempt_count: 0,
          last_error: null,
          processed_at: null,
          processing_started_at: null,
          scheduled_at: new Date().toISOString()
        })
        .eq("status", "failed");

      if (error) {
        throw new Error(`Failed to retry failed Instagram queue items: ${error.message}`);
      }
    },

    async cancel(id) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "cancelled",
          processing_started_at: null,
          processed_at: new Date().toISOString()
        })
        .eq("id", id)
        .in("status", ["pending", "failed", "processing"]);

      if (error) {
        throw new Error(`Failed to cancel Instagram queue item ${id}: ${error.message}`);
      }
    },

    async delete(id) {
      const { error } = await supabase
        .from("instagram_queue")
        .delete()
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to delete Instagram queue item ${id}: ${error.message}`);
      }
    },

    async list({ page, pageSize, status, search }) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from("instagram_queue")
        .select("*", { count: "exact" })
        .order("scheduled_at", { ascending: true })
        .order("created_at", { ascending: true })
        .range(from, to);

      if (status) {
        query = query.eq("status", status);
      }

      if (search) {
        const escaped = search.replaceAll("%", "\%").replaceAll("_", "\_");
        query = query.ilike("title", `%${escaped}%`);
      }

      const { data, count, error } = await query;

      if (error) {
        throw new Error(`Failed to list Instagram queue: ${error.message}`);
      }

      return {
        rows: data ?? [],
        total: count ?? 0
      };
    }
  };
}
