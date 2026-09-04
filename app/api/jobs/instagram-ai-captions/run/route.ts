import { after } from "next/server";
import { getCurrentSession, requireAdminRequest } from "@/lib/auth/session";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { runInstagramAiCaptionJob } from "@/lib/services/instagramAiCaptionJobRunner";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_RUNNING_MS = 120_000;

function isStale(updatedAt: string) {
  return Date.now() - new Date(updatedAt).getTime() > STALE_RUNNING_MS;
}

async function recoverStaleJob(job: { id: string; status: string; updated_at: string }) {
  if (job.status !== "running" || !isStale(job.updated_at)) {
    return false;
  }

  const { error } = await getSupabaseAdmin()
    .from("sync_jobs")
    .update({
      status: "queued",
      message: "Recovering stalled AI caption job. Continuing with next batch."
    })
    .eq("id", job.id)
    .eq("status", "running");

  if (error) {
    throw new Error(`Failed to recover stalled AI caption job: ${error.message}`);
  }

  return true;
}

export async function POST() {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const session = await getCurrentSession();

  if (!session) {
    return Response.json({ job: null }, { status: 401 });
  }

  const jobsRepository = createSyncJobsRepository();
  const job = await jobsRepository.getActiveForUser(session.userId, "instagram_ai_captions");

  if (job?.status === "queued") {
    after(() => runInstagramAiCaptionJob(job.id, session.userId));
  } else if (job?.status === "running" && await recoverStaleJob(job)) {
    after(() => runInstagramAiCaptionJob(job.id, session.userId));
  }

  return Response.json({ job });
}
