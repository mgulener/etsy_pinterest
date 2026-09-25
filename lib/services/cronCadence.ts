import { getSupabaseAdmin } from "@/lib/supabase/admin";

const CRON_DELIVERY_TOLERANCE_MS = 90_000;

export function isWithinCronCadence(lastPublishedAt: string | null, intervalMinutes: number, now = Date.now()) {
  if (!lastPublishedAt) return false;
  const publishedAt = Date.parse(lastPublishedAt);
  const minimumGap = Math.max(0, intervalMinutes * 60_000 - CRON_DELIVERY_TOLERANCE_MS);
  return Number.isFinite(publishedAt) && now - publishedAt < minimumGap;
}

export async function hasRecentSocialPublication(
  channel: "pinterest" | "instagram",
  intervalMinutes: number,
  now = new Date()
) {
  const table = channel === "pinterest" ? "pinterest_posts" : "instagram_posts";
  const { data, error } = await getSupabaseAdmin().from(table).select("published_at")
    .order("published_at", { ascending: false }).limit(1);
  if (error) throw new Error(`Failed to check ${channel} publication cadence.`);
  return isWithinCronCadence(data?.[0]?.published_at ?? null, intervalMinutes, now.getTime());
}
