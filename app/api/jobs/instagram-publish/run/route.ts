import { after } from "next/server";
import { getCurrentSession, requireAdminRequest } from "@/lib/auth/session";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { runInstagramPublishJob } from "@/lib/services/instagramPublishJobRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const session = await getCurrentSession();

  if (!session) {
    return Response.json({ job: null }, { status: 401 });
  }

  const job = await createSyncJobsRepository().getActiveForUser(session.userId, "instagram_publish");

  if (job?.status === "queued") {
    after(() => runInstagramPublishJob(job.id, session.userId));
  }

  return Response.json({ job });
}
