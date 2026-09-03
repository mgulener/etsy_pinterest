import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import type { EtsyListingRow } from "@/lib/supabase/types";

export type ListingWithPinterestStatus = EtsyListingRow & {
  pinterest_status: "queued" | "published" | "none";
};

export type ListingsPageResult = {
  rows: ListingWithPinterestStatus[];
  total: number;
};

export type ListingsRepository = {
  count(): Promise<number>;
  getExistingEtsyListingIds(ids: number[]): Promise<Set<number>>;
  upsertKnownListing(listing: NormalizedEtsyListing): Promise<void>;
  upsertKnownListings(listings: NormalizedEtsyListing[]): Promise<void>;
  updateLastSeen(listing: NormalizedEtsyListing): Promise<void>;
  list(params: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<ListingsPageResult>;
};

function toListingRow(listing: NormalizedEtsyListing) {
  return {
    etsy_listing_id: listing.etsyListingId,
    etsy_image_id: listing.etsyImageId,
    image_url: listing.imageUrl,
    title: listing.title,
    description: listing.description,
    url: listing.destinationUrl,
    state: listing.state,
    original_creation_timestamp: listing.originalCreationTimestamp
  };
}

export function createListingsRepository(): ListingsRepository {
  const supabase = getSupabaseAdmin();

  return {
    async count() {
      const { count, error } = await supabase
        .from("etsy_listings")
        .select("id", { count: "exact", head: true });

      if (error) {
        throw new Error(`Failed to count Etsy listings: ${error.message}`);
      }

      return count ?? 0;
    },

    async getExistingEtsyListingIds(ids: number[]) {
      if (ids.length === 0) {
        return new Set();
      }

      const existing = new Set<number>();
      const chunkSize = 500;

      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("etsy_listings")
          .select("etsy_listing_id")
          .in("etsy_listing_id", chunk);

        if (error) {
          throw new Error(`Failed to read known Etsy listings: ${error.message}`);
        }

        data?.forEach((row) => existing.add(row.etsy_listing_id));
      }

      return existing;
    },

    async upsertKnownListing(listing) {
      const now = new Date().toISOString();
      const { error } = await supabase.from("etsy_listings").upsert(
        {
          ...toListingRow(listing),
          last_seen_at: now
        },
        {
          onConflict: "etsy_listing_id"
        }
      );

      if (error) {
        throw new Error(`Failed to upsert Etsy listing ${listing.etsyListingId}: ${error.message}`);
      }
    },

    async upsertKnownListings(listings) {
      if (listings.length === 0) {
        return;
      }

      const now = new Date().toISOString();
      const chunkSize = 500;

      for (let i = 0; i < listings.length; i += chunkSize) {
        const chunk = listings.slice(i, i + chunkSize);
        const { error } = await supabase.from("etsy_listings").upsert(
          chunk.map((listing) => ({
            ...toListingRow(listing),
            last_seen_at: now
          })),
          {
            onConflict: "etsy_listing_id"
          }
        );

        if (error) {
          throw new Error(`Failed to batch upsert Etsy listings: ${error.message}`);
        }
      }
    },

    async updateLastSeen(listing) {
      const { error } = await supabase
        .from("etsy_listings")
        .update({
          etsy_image_id: listing.etsyImageId,
          image_url: listing.imageUrl,
          title: listing.title,
          description: listing.description,
          url: listing.destinationUrl,
          state: listing.state,
          original_creation_timestamp: listing.originalCreationTimestamp,
          last_seen_at: new Date().toISOString()
        })
        .eq("etsy_listing_id", listing.etsyListingId);

      if (error) {
        throw new Error(`Failed to update Etsy listing ${listing.etsyListingId}: ${error.message}`);
      }
    },

    async list({ page, pageSize, search }) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      let query = supabase
        .from("etsy_listings")
        .select("*", { count: "exact" })
        .order("last_seen_at", { ascending: false })
        .range(from, to);

      if (search) {
        const escaped = search.replaceAll("%", "\\%").replaceAll("_", "\\_");
        const numericSearch = Number(search);
        query = Number.isFinite(numericSearch)
          ? query.or(`title.ilike.%${escaped}%,etsy_listing_id.eq.${numericSearch}`)
          : query.ilike("title", `%${escaped}%`);
      }

      const { data, count, error } = await query;

      if (error) {
        throw new Error(`Failed to list Etsy listings: ${error.message}`);
      }

      const listingIds = (data ?? []).map((row) => row.etsy_listing_id);
      const queueStatuses = new Set<number>();
      const publishedStatuses = new Set<number>();

      if (listingIds.length > 0) {
        const { data: queueData, error: queueError } = await supabase
          .from("pin_queue")
          .select("etsy_listing_id")
          .in("etsy_listing_id", listingIds);

        if (queueError) {
          throw new Error(`Failed to read queue statuses: ${queueError.message}`);
        }

        queueData?.forEach((row) => queueStatuses.add(row.etsy_listing_id));

        const { data: postData, error: postError } = await supabase
          .from("pinterest_posts")
          .select("etsy_listing_id")
          .in("etsy_listing_id", listingIds);

        if (postError) {
          throw new Error(`Failed to read Pinterest statuses: ${postError.message}`);
        }

        postData?.forEach((row) => publishedStatuses.add(row.etsy_listing_id));
      }

      return {
        total: count ?? 0,
        rows: (data ?? []).map((row) => ({
          ...row,
          pinterest_status: publishedStatuses.has(row.etsy_listing_id)
            ? "published"
            : queueStatuses.has(row.etsy_listing_id)
              ? "queued"
              : "none"
        }))
      };
    }
  };
}
