import { getFacebookSettings } from "@/lib/repositories/facebookRepository";
import { INSTAGRAM_QUEUE_INTERVAL_MINUTES } from "@/lib/instagram/settings";
import { getEtsyAutomationUserId, getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PinQueueStatus } from "@/lib/supabase/types";

const HOUR_MS = 60 * 60_000;

export type AutomationChannelSnapshot = {
  enabled: boolean;
  pending: number;
  duePending: number;
  blocked: number;
  oldestDueAt: string | null;
  lastPublishedAt: string | null;
  intervalMinutes: number;
};

export type AutomationHealthSnapshot = {
  checkedAt: string;
  dryRun: boolean;
  etsy: {
    status: "queued" | "running" | "succeeded" | "failed" | "missing";
    completedAt: string | null;
  };
  pinterest: AutomationChannelSnapshot;
  instagram: AutomationChannelSnapshot;
  facebook: AutomationChannelSnapshot;
};

export type AutomationJobHealth = {
  job: "etsy" | "pinterest" | "instagram" | "facebook";
  status: "healthy" | "disabled" | "unhealthy";
  detail: string;
};

function validTime(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function evaluateChannel(
  job: AutomationJobHealth["job"],
  channel: AutomationChannelSnapshot,
  dryRun: boolean,
  now: number
): AutomationJobHealth {
  if (!channel.enabled) {
    if (channel.pending > 0) {
      return {
        job,
        status: "unhealthy",
        detail: `Automation is disabled while ${channel.pending} queue item(s) remain.`
      };
    }
    return { job, status: "disabled", detail: "Automation is disabled and has no overdue work." };
  }
  if (dryRun) return { job, status: "unhealthy", detail: "Dry-run is enabled; scheduled posts cannot publish." };
  if (channel.blocked > 0) {
    return { job, status: "unhealthy", detail: `${channel.blocked} queue item(s) require review.` };
  }
  if (channel.duePending === 0) {
    return {
      job,
      status: "healthy",
      detail: channel.pending === 0
        ? "Queue is complete."
        : `${channel.pending} scheduled item(s) remain; none are overdue.`
    };
  }

  const oldestDue = validTime(channel.oldestDueAt);
  const lastPublished = validTime(channel.lastPublishedAt);
  const overdueWindow = channel.intervalMinutes * 3 * 60_000;
  if (oldestDue !== null && now - oldestDue <= overdueWindow) {
    return { job, status: "healthy", detail: `${channel.duePending} item(s) are due within the normal window.` };
  }
  if (lastPublished !== null && now - lastPublished <= overdueWindow) {
    return { job, status: "healthy", detail: `${channel.duePending} item(s) remain and publishing is current.` };
  }
  return {
    job,
    status: "unhealthy",
    detail: `${channel.duePending} overdue item(s) exist without a recent confirmed publication.`
  };
}

export function evaluateAutomationHealth(snapshot: AutomationHealthSnapshot) {
  const now = Date.parse(snapshot.checkedAt);
  const jobs: AutomationJobHealth[] = [];
  const etsyCompleted = validTime(snapshot.etsy.completedAt);
  const etsyHealthy = snapshot.etsy.status === "succeeded" && etsyCompleted !== null && now - etsyCompleted <= 30 * HOUR_MS;
  jobs.push({
    job: "etsy",
    status: etsyHealthy ? "healthy" : "unhealthy",
    detail: etsyHealthy ? "The latest daily Etsy sync completed." : "No successful Etsy sync was confirmed in the last 30 hours."
  });
  jobs.push(evaluateChannel("pinterest", snapshot.pinterest, snapshot.dryRun, now));
  jobs.push(evaluateChannel("instagram", snapshot.instagram, snapshot.dryRun, now));
  jobs.push(evaluateChannel("facebook", snapshot.facebook, snapshot.dryRun, now));
  return {
    checkedAt: snapshot.checkedAt,
    healthy: jobs.every(job => job.status !== "unhealthy"),
    jobs
  };
}

async function countQueue(
  table: "pin_queue" | "instagram_queue" | "facebook_queue",
  statuses: PinQueueStatus[],
  before?: string
) {
  const db = getSupabaseAdmin();
  let query = db.from(table).select("id", { count: "exact", head: true }).in("status", statuses);
  if (before) query = query.lte("scheduled_at", before);
  const { count, error } = await query;
  if (error) throw new Error(`Failed to inspect ${table}.`);
  return count ?? 0;
}

async function oldestDue(table: "pin_queue" | "instagram_queue" | "facebook_queue", now: string) {
  const { data, error } = await getSupabaseAdmin().from(table).select("scheduled_at")
    .eq("status", "pending").lte("scheduled_at", now).order("scheduled_at").limit(1);
  if (error) throw new Error(`Failed to inspect ${table} schedule.`);
  return data?.[0]?.scheduled_at ?? null;
}

async function latestPublished(table: "pinterest_posts" | "instagram_posts" | "facebook_queue") {
  const query = table === "facebook_queue"
    ? getSupabaseAdmin().from("facebook_queue").select("published_at").eq("status", "published")
      .not("published_at", "is", null).order("published_at", { ascending: false }).limit(1)
    : getSupabaseAdmin().from(table).select("published_at").not("published_at", "is", null)
      .order("published_at", { ascending: false }).limit(1);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to inspect ${table} publications.`);
  return data?.[0]?.published_at ?? null;
}

export async function readAutomationHealthSnapshot(now = new Date()): Promise<AutomationHealthSnapshot> {
  const userId = await getEtsyAutomationUserId();
  if (!userId) throw new Error("No automation user is configured.");
  const checkedAt = now.toISOString();
  const [settings, facebook, latestSync] = await Promise.all([
    getSettingsForUser(userId),
    getFacebookSettings(userId),
    getSupabaseAdmin().from("sync_jobs").select("status,completed_at").eq("user_id", userId)
      .eq("type", "etsy_sync").order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  if (latestSync.error) throw new Error("Failed to inspect Etsy sync health.");

  const facebookEnabled = Boolean(facebook.settings?.enabled && facebook.settings?.automatic_enabled);
  const [pinterestPending, pinterestDue, pinterestBlocked, pinterestOldest, pinterestLatest,
    instagramPending, instagramDue, instagramBlocked, instagramOldest, instagramLatest,
    facebookPending, facebookDue, facebookBlocked, facebookOldest, facebookLatest] = await Promise.all([
    countQueue("pin_queue", ["pending"]),
    countQueue("pin_queue", ["pending"], checkedAt),
    countQueue("pin_queue", ["failed", "needs_review"]),
    oldestDue("pin_queue", checkedAt),
    latestPublished("pinterest_posts"),
    countQueue("instagram_queue", ["pending"]),
    countQueue("instagram_queue", ["pending"], checkedAt),
    countQueue("instagram_queue", ["failed", "needs_review"]),
    oldestDue("instagram_queue", checkedAt),
    latestPublished("instagram_posts"),
    countQueue("facebook_queue", ["pending"]),
    countQueue("facebook_queue", ["pending"], checkedAt),
    countQueue("facebook_queue", ["failed", "needs_review"]),
    oldestDue("facebook_queue", checkedAt),
    latestPublished("facebook_queue")
  ]);

  return {
    checkedAt,
    dryRun: settings.dryRun,
    etsy: {
      status: latestSync.data?.status ?? "missing",
      completedAt: latestSync.data?.completed_at ?? null
    },
    pinterest: {
      enabled: settings.pinterestEnabled,
      pending: pinterestPending,
      duePending: pinterestDue,
      blocked: pinterestBlocked,
      oldestDueAt: pinterestOldest,
      lastPublishedAt: pinterestLatest,
      intervalMinutes: 15
    },
    instagram: {
      enabled: settings.instagramEnabled,
      pending: instagramPending,
      duePending: instagramDue,
      blocked: instagramBlocked,
      oldestDueAt: instagramOldest,
      lastPublishedAt: instagramLatest,
      intervalMinutes: INSTAGRAM_QUEUE_INTERVAL_MINUTES
    },
    facebook: {
      enabled: facebookEnabled,
      pending: facebookPending,
      duePending: facebookDue,
      blocked: facebookBlocked,
      oldestDueAt: facebookOldest,
      lastPublishedAt: facebookLatest,
      intervalMinutes: facebook.settings?.interval_minutes ?? 15
    }
  };
}
