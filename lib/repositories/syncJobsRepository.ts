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
  complete(id: string, result: Json, message: string, errorMessage?: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
};

// The Pro worker may run for up to 800 seconds; leave a small recovery buffer.
const ETSY_SYNC_STALE_MS = 20 * 60_000;

export function createSyncJobsRepository(supabase = getSupabaseAdmin()): SyncJobsRepository {
  async function readJob(userId: string, type: SyncJobType, activeOnly: boolean) {
    const read = () => {
      let query = supabase.from("sync_jobs").select("*").eq("user_id", userId).eq("type", type);
      if (activeOnly) query = query.in("status", ["queued", "running"]);
      return query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    };
    let { data, error } = await read();
    if (error) throw new Error(`Failed to read job: ${error.message}`);

    if (type === "etsy_sync" && data?.status === "running" &&
        Date.parse(data.updated_at) < Date.now() - ETSY_SYNC_STALE_MS) {
      const { error: recoveryError } = await supabase.from("sync_jobs").update({
        status: "failed",
        message: "Etsy sync interrupted. Start Sync Etsy again to retry.",
        error: "No progress for 20 minutes. The previous worker may have stopped or timed out.",
        completed_at: new Date().toISOString()
      }).eq("id", data.id).eq("user_id", userId).eq("type", "etsy_sync")
        .eq("status", "running").eq("updated_at", data.updated_at);
      if (recoveryError) throw new Error(`Failed to recover interrupted Etsy sync: ${recoveryError.message}`);
      // Read again: a worker may have advanced between the read and conditional update.
      ({ data, error } = await read());
      if (error) throw new Error(`Failed to read recovered job: ${error.message}`);
    }
    return data;
  }

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
      return readJob(userId, type, false);
    },

    async getActiveForUser(userId, type) {
      return readJob(userId, type, true);
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
        .eq("id", id)
        .eq("status", "running");

      if (error) {
        throw new Error(`Failed to update job progress: ${error.message}`);
      }
    },

    async complete(id, result, message, errorMessage) {
      const { error } = await supabase
        .from("sync_jobs")
        .update({
          status: errorMessage ? "failed" : "succeeded",
          progress_current: 100,
          progress_total: 100,
          message,
          result,
          error: errorMessage ?? null,
          completed_at: new Date().toISOString()
        })
        .eq("id", id)
        .eq("status", "running");

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
        .eq("id", id)
        .eq("status", "running");

      if (error) {
        throw new Error(`Failed to fail job: ${error.message}`);
      }
    }
  };
}
