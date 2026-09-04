import { getCurrentSession, requireAdminRequest } from "@/lib/auth/session";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const session = await getCurrentSession();

  if (!session) {
    return Response.json({ job: null }, { status: 401 });
  }

  const job = await createSyncJobsRepository().getLatestForUser(session.userId, "etsy_sync");
  return Response.json({ job });
}
