import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PinterestPostRow } from "@/lib/supabase/types";

export type PinterestPostsPageResult = {
  rows: PinterestPostRow[];
  total: number;
};

export type PinterestPostsRepository = {
  count(): Promise<number>;
  findByEtsyListingId(etsyListingId: number): Promise<PinterestPostRow | null>;
  createPost(input: {
    etsyListingId: number;
    etsyImageId: number | null;
    pinterestPinId: string;
    pinterestBoardId: string;
  }): Promise<void>;
  list(params: {
    page: number;
    pageSize: number;
  }): Promise<PinterestPostsPageResult>;
};

export function createPinterestPostsRepository(): PinterestPostsRepository {
  const supabase = getSupabaseAdmin();

  return {
    async count() {
      const { count, error } = await supabase
        .from("pinterest_posts")
        .select("id", { count: "exact", head: true });

      if (error) {
        throw new Error(`Failed to count Pinterest posts: ${error.message}`);
      }

      return count ?? 0;
    },

    async findByEtsyListingId(etsyListingId) {
      const { data, error } = await supabase
        .from("pinterest_posts")
        .select("*")
        .eq("etsy_listing_id", etsyListingId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to find Pinterest post: ${error.message}`);
      }

      return data;
    },

    async createPost(input) {
      const { error } = await supabase.from("pinterest_posts").insert({
        etsy_listing_id: input.etsyListingId,
        etsy_image_id: input.etsyImageId,
        pinterest_pin_id: input.pinterestPinId,
        pinterest_board_id: input.pinterestBoardId
      });

      if (error?.code === "23505") {
        return;
      }

      if (error) {
        throw new Error(`Failed to create Pinterest post: ${error.message}`);
      }
    },

    async list({ page, pageSize }) {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const { data, count, error } = await supabase
        .from("pinterest_posts")
        .select("*", { count: "exact" })
        .order("published_at", { ascending: false })
        .range(from, to);

      if (error) {
        throw new Error(`Failed to list Pinterest posts: ${error.message}`);
      }

      return {
        rows: data ?? [],
        total: count ?? 0
      };
    }
  };
}
