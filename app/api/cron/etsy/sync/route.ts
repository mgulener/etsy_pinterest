import { validateCronRequest } from "@/lib/auth/cron";
import { getEtsyAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { runEtsySyncJob } from "@/lib/services/syncJobRunner";
import { scheduledEtsySync } from "@/lib/services/scheduledEtsySync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    return await scheduledEtsySync({
      resolveUserId: getEtsyAutomationUserId,
      jobs: createSyncJobsRepository(),
      run: runEtsySyncJob
    });
  } catch {
    return Response.json(
      { error: "Scheduled Etsy sync failed. Review the latest sync job before retrying." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
