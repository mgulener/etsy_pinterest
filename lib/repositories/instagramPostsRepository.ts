import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { InstagramPostRow } from "@/lib/supabase/types";

export type InstagramPostsPageResult = {
  rows: InstagramPostRow[];
  total: number;
};

export type InstagramPostsRepository = {
  count(): Promise<number>;
  findByEtsyListingId(etsyListingId: number): Promise<InstagramPostRow | null>;
  createPost(input: {
    etsyListingId: number;
    etsyImageId: number | null;
    instagramMediaId: string;
    instagramCreationId?: string;
    mediaType: string;
    caption: string;
    instagramPermalink?: string;
  }): Promise<void>;
  list(params: {
    page: number;
    pageSize: number;
  }): Promise<InstagramPostsPageResult>;
};

export function createInstagramPostsRepository(): InstagramPostsRepository {
  const supabase = getSupabaseAdmin();

  return {
    async count() {
      const { count, error } = await supabase
        .from("instagram_posts")
        .select("id", { count: "exact", head: true });

      if (error) {
        throw new Error(`Failed to count Instagram posts: ${error.message}`);
      }

      return count ?? 0;
    },

    async findByEtsyListingId(etsyListingId) {
      const { data, error } = await supabase
        .from("instagram_posts")
        .select("*")
        .eq("etsy_listing_id", etsyListingId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to find Instagram post: ${error.message}`);
      }

      return data;
    },

    async createPost(input) {
      const { error } = await supabase.from("instagram_posts").insert({
        etsy_listing_id: input.etsyListingId,
        etsy_image_id: input.etsyImageId,
        instagram_media_id: input.instagramMediaId,
        instagram_creation_id: input.instagramCreationId ?? null,
        media_type: input.mediaType,
        caption: input.caption,
        instagram_permalink: input.instagramPermalink ?? null
      });

      if (error?.code === "23505") {
        return;
      }

      if (error) {
        throw new Error(`Failed to create Instagram post: ${error.message}`);
      }
    },

    async list({ page, pageSize }) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error } = await supabase
        .from("instagram_posts")
        .select("*", { count: "exact" })
        .order("published_at", { ascending: false })
        .range(from, to);

      if (error) {
        throw new Error(`Failed to list Instagram posts: ${error.message}`);
      }

      return {
        rows: data ?? [],
        total: count ?? 0
      };
    }
  };
}
