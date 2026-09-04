import { getSupabaseAdmin } from "@/lib/supabase/admin";

const INITIAL_SYNC_COMPLETED_KEY = "initial_sync_completed";

export type AppSettingsRepository = {
  isInitialSyncCompleted(): Promise<boolean>;
  setInitialSyncCompleted(value: boolean): Promise<void>;
  getDismissedProgressJobIds(userId: string): Promise<string[]>;
  dismissProgressJobForUser(userId: string, jobId: string): Promise<void>;
};

function dismissedProgressJobsKey(userId: string) {
  return `dismissed_progress_jobs:${userId}`;
}

function parseDismissedProgressJobs(value: unknown) {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

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
    },

    async getDismissedProgressJobIds(userId) {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", dismissedProgressJobsKey(userId))
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read dismissed progress jobs: ${error.message}`);
      }

      return parseDismissedProgressJobs(data?.value);
    },

    async dismissProgressJobForUser(userId, jobId) {
      const dismissedJobIds = await this.getDismissedProgressJobIds(userId);
      const nextDismissedJobIds = Array.from(new Set([jobId, ...dismissedJobIds])).slice(0, 50);
      const { error } = await supabase.from("app_settings").upsert(
        {
          key: dismissedProgressJobsKey(userId),
          value: nextDismissedJobIds
        },
        {
          onConflict: "key"
        }
      );

      if (error) {
        throw new Error(`Failed to dismiss progress job: ${error.message}`);
      }
    }
  };
}
