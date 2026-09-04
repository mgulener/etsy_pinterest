import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json, SyncJobRow, SyncJobType } from "@/lib/supabase/types";

export type SyncJobProgressInput = {
  current: number;
  total?: number;
  message: string;
};

export type SyncJobsRepository = {
  create(input: { userId: string; type: SyncJobType; message?: string; syncLimit?: number | null }): Promise<SyncJobRow>;
  getLatestForUser(userId: string, type: SyncJobType): Promise<SyncJobRow | null>;
  getActiveForUser(userId: string, type: SyncJobType): Promise<SyncJobRow | null>;
  claimQueued(id: string): Promise<SyncJobRow | null>;
  requeue(id: string, progress: SyncJobProgressInput, result?: Json): Promise<void>;
  updateProgress(id: string, progress: SyncJobProgressInput): Promise<void>;
  complete(id: string, result: Json, message: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
};

export function createSyncJobsRepository(): SyncJobsRepository {
  const supabase = getSupabaseAdmin();

  return {
    async create({ userId, type, message = "Queued", syncLimit = null }) {
      const { data, error } = await supabase
        .from("sync_jobs")
        .insert({ user_id: userId, type, message, sync_limit: syncLimit })
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to create job: ${error.message}`);
      }

      return data;
    },

    async getLatestForUser(userId, type) {
      const { data, error } = await supabase
        .from("sync_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("type", type)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read latest job: ${error.message}`);
      }

      return data;
    },

    async getActiveForUser(userId, type) {
      const { data, error } = await supabase
        .from("sync_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("type", type)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to read active job: ${error.message}`);
      }

      return data;
    },

    async claimQueued(id) {
      const { data, error } = await supabase
        .from("sync_jobs")
        .update({
          status: "running",
          started_at: new Date().toISOString(),
          message: "Starting job"
        })
        .eq("id", id)
        .eq("status", "queued")
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to claim job: ${error.message}`);
      }

      return data;
    },

    async requeue(id, progress, result = null) {
      const { error } = await supabase
        .from("sync_jobs")
        .update({
          status: "queued",
          progress_current: Math.max(0, progress.current),
          progress_total: Math.max(progress.total ?? 100, 1),
          message: progress.message,
          result,
          error: null
        })
        .eq("id", id)
        .eq("status", "running");

      if (error) {
        throw new Error(`Failed to requeue job: ${error.message}`);
      }
    },

    async updateProgress(id, progress) {
      const { error } = await supabase
        .from("sync_jobs")
        .update({
          progress_current: Math.max(0, progress.current),
          progress_total: Math.max(progress.total ?? 100, 1),
          message: progress.message
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to update job progress: ${error.message}`);
      }
    },

    async complete(id, result, message) {
      const { error } = await supabase
        .from("sync_jobs")
        .update({
          status: "succeeded",
          progress_current: 100,
          progress_total: 100,
          message,
          result,
          error: null,
          completed_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to complete job: ${error.message}`);
      }
    },

    async fail(id, errorMessage) {
      const { error } = await supabase
        .from("sync_jobs")
        .update({
          status: "failed",
          message: "Job failed",
          error: errorMessage,
          completed_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        throw new Error(`Failed to fail job: ${error.message}`);
      }
    }
  };
}
