import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { paginateQueue } from "@/lib/queue/pagination";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import {
  buildScheduledAt,
  DEFAULT_QUEUE_INTERVAL_MINUTES,
  getNextScheduleStart,
  sortQueueRowsForPublishing
} from "@/lib/queue/scheduling";
import type { PinQueueRow, PinQueueStatus } from "@/lib/supabase/types";

export type QueuePageResult = {
  rows: PinQueueRow[];
  total: number;
};

export type PinQueueRepository = {
  countByStatus(status: PinQueueStatus): Promise<number>;
  enqueueListing(listing: NormalizedEtsyListing, boardId: string, options?: { scheduledAt?: string }): Promise<"created" | "duplicate">;
  enqueueListings(items: Array<{
    listing: NormalizedEtsyListing;
    boardId: string;
    scheduledAt?: string;
  }>): Promise<number>;
  listPendingByBoard(boardId: string): Promise<PinQueueRow[]>;
  updateBoardAssignments(assignments: Array<{ id: string; boardId: string }>): Promise<number>;
  updateSchedule(id: string, scheduledAt: string): Promise<void>;
  rebuildPendingSchedule(intervalMinutes?: number): Promise<number>;
  listPending(limit: number): Promise<PinQueueRow[]>;
  claimPending(id: string): Promise<PinQueueRow | null>;
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
  }): Promise<QueuePageResult>;
};

const scheduleUpdateBatchSize = 25;

export function createPinQueueRepository(): PinQueueRepository {
  const supabase = getSupabaseAdmin();

  return {
    async countByStatus(status) {
      const { count, error } = await supabase
        .from("pin_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status);

      if (error) {
        throw new Error(`Failed to count queue status ${status}: ${error.message}`);
      }

      return count ?? 0;
    },

    async enqueueListing(listing, boardId, options) {
      const { error } = await supabase.from("pin_queue").insert({
        etsy_listing_id: listing.etsyListingId,
        etsy_image_id: listing.etsyImageId,
        image_url: listing.imageUrl,
        title: listing.title,
        description: listing.description,
        destination_url: listing.destinationUrl,
        board_id: boardId,
        scheduled_at: options?.scheduledAt ?? new Date().toISOString(),
        schedule_locked: false
      });

      if (error?.code === "23505") {
        return "duplicate";
      }

      if (error) {
        throw new Error(`Failed to enqueue Etsy listing ${listing.etsyListingId}: ${error.message}`);
      }

      return "created";
    },

    async enqueueListings(items) {
      if (items.length === 0) {
        return 0;
      }

      let created = 0;
      const chunkSize = 200;

      for (let index = 0; index < items.length; index += chunkSize) {
        const chunk = items.slice(index, index + chunkSize);
        const listingIds = chunk.map(({ listing }) => listing.etsyListingId);
        const { data: publishedRows, error: publishedError } = await supabase
          .from("pinterest_posts")
          .select("etsy_listing_id")
          .in("etsy_listing_id", listingIds);

        if (publishedError) {
          throw new Error(`Failed to check published Pinterest listings: ${publishedError.message}`);
        }

        const publishedIds = new Set(
          publishedRows?.map((row) => row.etsy_listing_id) ?? []
        );
        const unpublishedChunk = chunk.filter(
          ({ listing }) => !publishedIds.has(listing.etsyListingId)
        );

        if (unpublishedChunk.length === 0) {
          continue;
        }

        const { data, error } = await supabase
          .from("pin_queue")
          .upsert(
            unpublishedChunk.map(({ listing, boardId, scheduledAt }) => ({
              etsy_listing_id: listing.etsyListingId,
              etsy_image_id: listing.etsyImageId,
              image_url: listing.imageUrl,
              title: listing.title,
              description: listing.description,
              destination_url: listing.destinationUrl,
              board_id: boardId,
              scheduled_at: scheduledAt ?? new Date().toISOString(),
              schedule_locked: false
            })),
            {
              onConflict: "etsy_listing_id",
              ignoreDuplicates: true
            }
          )
          .select("etsy_listing_id");

        if (error) {
          throw new Error(`Failed to batch enqueue Pinterest listings: ${error.message}`);
        }

        created += data?.length ?? 0;
      }

      return created;
    },

    async listPendingByBoard(boardId) {
      const pageSize = 1000;
      const rows: PinQueueRow[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("pin_queue")
          .select("*")
          .eq("board_id", boardId)
          .eq("status", "pending")
          .range(from, from + pageSize - 1);

        if (error) {
          throw new Error(`Failed to list fallback Pinterest queue: ${error.message}`);
        }

        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < pageSize) {
          break;
        }
        from += pageSize;
      }

      return rows;
    },

    async updateBoardAssignments(assignments) {
      let updated = 0;
      const batchSize = 25;

      for (let index = 0; index < assignments.length; index += batchSize) {
        const batch = assignments.slice(index, index + batchSize);
        const results = await Promise.all(batch.map(({ id, boardId }) =>
          supabase
            .from("pin_queue")
            .update({ board_id: boardId })
            .eq("id", id)
            .eq("status", "pending")
            .select("id")
        ));
        const error = results.find((result) => result.error)?.error;

        if (error) {
          throw new Error(`Failed to update Pinterest board assignments: ${error.message}`);
        }

        updated += results.reduce((count, result) => count + (result.data?.length ?? 0), 0);
      }

      return updated;
    },

    async updateSchedule(id, scheduledAt) {
      const { error } = await supabase
        .from("pin_queue")
        .update({ scheduled_at: scheduledAt, schedule_locked: true })
        .eq("id", id)
        .in("status", ["pending", "failed", "cancelled"]);

      if (error) {
        throw new Error(`Failed to update pin queue schedule ${id}: ${error.message}`);
      }
    },

    async rebuildPendingSchedule(intervalMinutes = DEFAULT_QUEUE_INTERVAL_MINUTES) {
      const pageSize = 1000;
      const data: Array<{
        id: string;
        title: string;
        description: string | null;
        created_at?: string;
        scheduled_at?: string;
      }> = [];
      let from = 0;
      let readMore = true;

      while (readMore) {
        const { data: page, error } = await supabase
          .from("pin_queue")
          .select("id, title, description, created_at, scheduled_at")
          .eq("status", "pending")
          .eq("schedule_locked", false)
          .range(from, from + pageSize - 1);

        if (error) {
          throw new Error(`Failed to read pin queue for schedule rebuild: ${error.message}`);
        }

        data.push(...(page ?? []));
        readMore = (page?.length ?? 0) === pageSize;
        from += pageSize;
      }

      const rows = sortQueueRowsForPublishing(data);
      const startDate = getNextScheduleStart(intervalMinutes);

      let updateError: { message: string } | null = null;

      for (let fromIndex = 0; fromIndex < rows.length; fromIndex += scheduleUpdateBatchSize) {
        const batch = rows.slice(fromIndex, fromIndex + scheduleUpdateBatchSize);
        const results = await Promise.all(batch.map((item, offset) =>
          supabase
            .from("pin_queue")
            .update({
              scheduled_at: buildScheduledAt(fromIndex + offset, intervalMinutes, startDate),
              schedule_locked: false
            })
            .eq("id", item.id)
        ));

        updateError = results.find((result) => result.error)?.error ?? null;

        if (updateError) {
          break;
        }
      }

      if (updateError) {
        throw new Error("Failed to rebuild pin queue schedule: " + updateError.message);
      }

      return rows.length;
    },

    async listPending(limit) {
      const { data, error } = await supabase
        .from("pin_queue")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to read pending pin queue: ${error.message}`);
      }

      return data ?? [];
    },

    async claimPending(id) {
      const { data, error } = await supabase
        .from("pin_queue")
        .update({
          status: "processing",
          last_error: null
        })
        .eq("id", id)
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to claim queue item ${id}: ${error.message}`);
      }

      return data;
    },

    async markPublished(id) {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "published",
          processed_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to mark queue item ${id} as published: ${error.message}`);
      }
    },

    async markRetryable(id, errorMessage, attemptCount, retryScheduledAt) {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "pending",
          attempt_count: attemptCount,
          last_error: errorMessage,
          scheduled_at: retryScheduledAt,
          schedule_locked: false
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to return queue item ${id} to pending: ${error.message}`);
      }
    },

    async markFailed(id, errorMessage, attemptCount) {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "failed",
          attempt_count: attemptCount,
          last_error: errorMessage,
          processed_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to mark queue item ${id} as failed: ${error.message}`);
      }
    },

    async markPendingAfterDryRun(id) {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "pending",
          last_error: null
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to restore dry-run queue item ${id}: ${error.message}`);
      }
    },

    async retry(id) {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "pending",
          attempt_count: 0,
          last_error: null,
          processed_at: null,
          scheduled_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("status", "failed");

      if (error) {
        throw new Error(`Failed to retry queue item ${id}: ${error.message}`);
      }
    },

    async retryAllFailed() {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "pending",
          attempt_count: 0,
          last_error: null,
          processed_at: null,
          scheduled_at: new Date().toISOString()
        })
        .eq("status", "failed");

      if (error) {
        throw new Error(`Failed to retry failed queue items: ${error.message}`);
      }
    },

    async cancel(id) {
      const { error } = await supabase
        .from("pin_queue")
        .update({
          status: "cancelled",
          processed_at: new Date().toISOString()
        })
        .eq("id", id)
        .in("status", ["pending", "failed", "processing"]);

      if (error) {
        throw new Error(`Failed to cancel queue item ${id}: ${error.message}`);
      }
    },

    async delete(id) {
      const { error } = await supabase
        .from("pin_queue")
        .delete()
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to delete queue item ${id}: ${error.message}`);
      }
    },

    async list({ page, pageSize, status, search }) {
      return paginateQueue<PinQueueRow>({
        page, pageSize, filtered: Boolean(status),
        async read(partition, from, limit) {
          let query = supabase
            .from("pin_queue")
            .select("*", { count: "exact", head: limit === 0 })
            .order("scheduled_at", { ascending: true })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true });
          if (limit > 0) query = query.range(from, from + limit - 1);
          if (partition === "unpublished") query = query.neq("status", "published");
          if (partition === "published") query = query.eq("status", "published");

          if (status) {
            query = query.eq("status", status);
          }

          if (search) {
            const escaped = search.replaceAll("%", "\%").replaceAll("_", "\_");
            query = query.ilike("title", `%${escaped}%`);
          }

          const { data, count, error } = await query;

          if (error) {
            throw new Error(`Failed to list pin queue: ${error.message}`);
          }

          return {
            rows: data ?? [],
            total: count ?? 0
          };
        }
      });
    }
  };
}
