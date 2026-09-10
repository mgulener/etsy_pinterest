import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PinterestBoardMappingRow } from "@/lib/supabase/types";

export type PinterestBoardMappingInput = {
  userId: string;
  etsyShopSectionId: number;
  etsySectionTitle: string;
  pinterestBoardId: string;
  pinterestBoardName: string;
};

export type PinterestBoardMappingsRepository = {
  listForUser(userId: string): Promise<PinterestBoardMappingRow[]>;
  findBoardId(userId: string, etsyShopSectionId: number): Promise<string | null>;
  upsert(mapping: PinterestBoardMappingInput): Promise<void>;
};

export function createPinterestBoardMappingsRepository(): PinterestBoardMappingsRepository {
  const supabase = getSupabaseAdmin();

  return {
    async listForUser(userId) {
      const { data, error } = await supabase
        .from("pinterest_board_mappings")
        .select("*")
        .eq("user_id", userId)
        .order("etsy_section_title", { ascending: true });

      if (error) {
        throw new Error(`Failed to list Pinterest board mappings: ${error.message}`);
      }

      return data ?? [];
    },

    async findBoardId(userId, etsyShopSectionId) {
      const { data, error } = await supabase
        .from("pinterest_board_mappings")
        .select("pinterest_board_id")
        .eq("user_id", userId)
        .eq("etsy_shop_section_id", etsyShopSectionId)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to find Pinterest board mapping: ${error.message}`);
      }

      return data?.pinterest_board_id ?? null;
    },

    async upsert(mapping) {
      const { error } = await supabase
        .from("pinterest_board_mappings")
        .upsert(
          {
            user_id: mapping.userId,
            etsy_shop_section_id: mapping.etsyShopSectionId,
            etsy_section_title: mapping.etsySectionTitle,
            pinterest_board_id: mapping.pinterestBoardId,
            pinterest_board_name: mapping.pinterestBoardName
          },
          { onConflict: "user_id,etsy_shop_section_id" }
        );

      if (error) {
        throw new Error(`Failed to save Pinterest board mapping: ${error.message}`);
      }
    }
  };
}
