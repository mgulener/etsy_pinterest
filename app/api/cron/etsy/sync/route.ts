import { validateCronRequest } from "@/lib/auth/cron";
import { getEtsyAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
import { runEtsySyncJob } from "@/lib/services/syncJobRunner";
import { scheduledEtsySync } from "@/lib/services/scheduledEtsySync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);
  if (unauthorized) return unauthorized;

  return scheduledEtsySync({
    resolveUserId: getEtsyAutomationUserId,
    jobs: createSyncJobsRepository(),
    run: runEtsySyncJob
  });
}
