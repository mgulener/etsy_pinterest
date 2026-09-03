import { getSupabaseAdmin } from "@/lib/supabase/admin";

const INITIAL_SYNC_COMPLETED_KEY = "initial_sync_completed";

export type AppSettingsRepository = {
  isInitialSyncCompleted(): Promise<boolean>;
  setInitialSyncCompleted(value: boolean): Promise<void>;
};

export function createAppSettingsRepository(): AppSettingsRepository {
  const supabase = getSupabaseAdmin();

  return {
    async isInitialSyncCompleted() {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", INITIAL_SYNC_COMPLETED_KEY)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read app setting: ${error.message}`);
      }

      return data?.value === true;
    },

    async setInitialSyncCompleted(value: boolean) {
      const { error } = await supabase.from("app_settings").upsert(
        {
          key: INITIAL_SYNC_COMPLETED_KEY,
          value
        },
        {
          onConflict: "key"
        }
      );

      if (error) {
        throw new Error(`Failed to update app setting: ${error.message}`);
      }
    }
  };
}
