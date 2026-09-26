import type { SyncJobsRepository } from "@/lib/repositories/syncJobsRepository";

const DAILY_SYNC_HOUR_UTC = 3;

export function getDailySyncWindowStart(now: Date) {
  const start = new Date(now);
  start.setUTCHours(DAILY_SYNC_HOUR_UTC, 0, 0, 0);

  if (start.getTime() > now.getTime()) {
    start.setUTCDate(start.getUTCDate() - 1);
  }

  return start;
}

export async function scheduledEtsySync(input: {
  resolveUserId: () => Promise<string | null>;
  jobs: Pick<SyncJobsRepository, "getActiveForUser" | "create" | "getLatestForUser">;
  run: (jobId: string, userId: string) => Promise<void>;
  now?: () => Date;
}) {
  const userId = await input.resolveUserId();
  if (!userId) {
    return Response.json({ error: "No Etsy automation user configured. Connect Etsy from Settings." }, { status: 409 });
  }

  const active = await input.jobs.getActiveForUser(userId, "etsy_sync");
  if (active?.status === "running") {
    return Response.json({ jobId: active.id, status: "running" }, { status: 202 });
  }
  const latest = await input.jobs.getLatestForUser(userId, "etsy_sync");
  const completedAt = latest?.completed_at ? Date.parse(latest.completed_at) : Number.NaN;
  const syncWindowStart = getDailySyncWindowStart(input.now?.() ?? new Date()).getTime();
  if (latest?.status === "succeeded" && Number.isFinite(completedAt) && completedAt >= syncWindowStart) {
    return Response.json({ jobId: latest.id, status: "succeeded", skipped: true, result: latest.result });
  }
  const job = active ?? await input.jobs.create({ userId, type: "etsy_sync", message: "Daily Etsy sync queued" });
  await input.run(job.id, userId);
  const completed = await input.jobs.getLatestForUser(userId, "etsy_sync");
  if (!completed || completed.id !== job.id) {
    throw new Error("Could not verify scheduled Etsy sync result");
  }
  return Response.json(
    { jobId: completed.id, status: completed.status, result: completed.result, error: completed.error },
    { status: completed.status === "failed" ? 500 : completed.status === "succeeded" ? 200 : 202 }
  );
}
