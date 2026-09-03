import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import type { InstagramQueueRow, PinQueueStatus } from "@/lib/supabase/types";

export type InstagramQueuePageResult = {
  rows: InstagramQueueRow[];
  total: number;
};

export type InstagramQueueRepository = {
  countByStatus(status: PinQueueStatus): Promise<number>;
  enqueueListing(listing: NormalizedEtsyListing): Promise<"created" | "duplicate">;
  listPending(limit: number): Promise<InstagramQueueRow[]>;
  claimPending(id: string): Promise<InstagramQueueRow | null>;
  markPublished(id: string): Promise<void>;
  markRetryable(id: string, error: string, attemptCount: number): Promise<void>;
  markFailed(id: string, error: string, attemptCount: number): Promise<void>;
  markPendingAfterDryRun(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  retryAllFailed(): Promise<void>;
  cancel(id: string): Promise<void>;
  list(params: {
    page: number;
    pageSize: number;
    status?: PinQueueStatus;
  }): Promise<InstagramQueuePageResult>;
};

function buildInstagramCaption(listing: NormalizedEtsyListing) {
  const urlLine = listing.destinationUrl ? `\n\nShop on Etsy: ${listing.destinationUrl}` : "";
  const body = [listing.title, listing.description].filter(Boolean).join("\n\n");
  const maxBodyLength = Math.max(2200 - urlLine.length, 0);

  return `${body.slice(0, maxBodyLength).trimEnd()}${urlLine}`.slice(0, 2200);
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

    async enqueueListing(listing) {
      const { error } = await supabase.from("instagram_queue").insert({
        etsy_listing_id: listing.etsyListingId,
        etsy_image_id: listing.etsyImageId,
        image_url: listing.imageUrl,
        title: listing.title,
        description: listing.description,
        destination_url: listing.destinationUrl,
        caption: buildInstagramCaption(listing),
        scheduled_at: new Date().toISOString()
      });

      if (error?.code === "23505") {
        return "duplicate";
      }

      if (error) {
        throw new Error(`Failed to enqueue Instagram item ${listing.etsyListingId}: ${error.message}`);
      }

      return "created";
    },

    async listPending(limit) {
      const { data, error } = await supabase
        .from("instagram_queue")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
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
          last_error: null
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

    async markRetryable(id, errorMessage, attemptCount) {
      const { error } = await supabase
        .from("instagram_queue")
        .update({
          status: "pending",
          attempt_count: attemptCount,
          last_error: errorMessage
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
          last_error: null
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
          processed_at: new Date().toISOString()
        })
        .eq("id", id)
        .in("status", ["pending", "failed", "processing"]);

      if (error) {
        throw new Error(`Failed to cancel Instagram queue item ${id}: ${error.message}`);
      }
    },

    async list({ page, pageSize, status }) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from("instagram_queue")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);

      if (status) {
        query = query.eq("status", status);
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
