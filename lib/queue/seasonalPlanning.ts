import type { EventClassification } from "./eventClassification";
import { calendarDate, calendarDays, eventOccurrence, marketDay, type EventId } from "./seasonalCalendar";
import { buildScheduledAt, getNextScheduleStart } from "./scheduling";

export type SeasonalPolicy = { enabled: boolean; leadTimeDays: number; lookaheadDays: number };
export const DEFAULT_SEASONAL_POLICY: SeasonalPolicy = { enabled: false, leadTimeDays: 14, lookaheadDays: 90 };
export type SeasonalRank = { tier: number; urgency: number; event: EventId | null; deadline: string | null; reason: string };

export function validateSeasonalPolicy(policy: SeasonalPolicy) {
  if (!Number.isInteger(policy.leadTimeDays) || policy.leadTimeDays < 0 || policy.leadTimeDays > 60 ||
      !Number.isInteger(policy.lookaheadDays) || policy.lookaheadDays < 1 || policy.lookaheadDays > 365) {
    throw new Error("Invalid seasonal planning window.");
  }
}

export function rankSeasonalProduct(classification: EventClassification | undefined, policy: SeasonalPolicy, now = new Date()): SeasonalRank {
  validateSeasonalPolicy(policy);
  const base = { urgency: 0, event: null, deadline: null };
  if (!classification || classification.kind === "review" || classification.confidence !== "high") {
    return { ...base, tier: 3, reason: "Classification needs review; no automatic seasonal promotion." };
  }
  if (classification.kind === "evergreen") return { ...base, tier: 1, reason: "Year-round product." };
  const today = marketDay(now);
  const currentYear = new Date(today).getUTCFullYear();
  const candidates: SeasonalRank[] = [];
  for (const event of classification.events) {
    const years = classification.targetYear === null ? [currentYear - 1, currentYear, currentYear + 1] : [classification.targetYear];
    for (const year of years) {
      const { start, end } = eventOccurrence(event, year);
      const deadline = end - calendarDays(policy.leadTimeDays);
      if (deadline < today) continue;
      const inWindow = start - calendarDays(policy.lookaheadDays) <= today;
      candidates.push({ tier: inWindow ? 0 : 2, urgency: Math.max(today, start - calendarDays(policy.leadTimeDays)), event,
        deadline: calendarDate(deadline), reason: inWindow ? "Within the seasonal window and delivery cutoff." : "Future season; not yet in its promotion window." });
    }
  }
  candidates.sort((a, b) => a.tier - b.tier || a.urgency - b.urgency || a.event!.localeCompare(b.event!));
  return candidates[0] ?? { ...base, tier: 4, reason: "Dated event or delivery cutoff has passed." };
}

export type SeasonalQueueItem = {
  id: string; etsy_listing_id: number; status: string; schedule_locked: boolean;
  scheduled_at: string; created_at: string; updated_at: string;
};

export function planSeasonalQueue<T extends SeasonalQueueItem>(input: {
  rows: T[]; classifications: Map<number, EventClassification>; policy: SeasonalPolicy;
  intervalMinutes: number; now?: Date;
}) {
  const { rows, classifications, policy, intervalMinutes, now = new Date() } = input;
  validateSeasonalPolicy(policy);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) throw new Error("Invalid publication interval.");
  const compare = (a: { row: T; rank: SeasonalRank }, b: { row: T; rank: SeasonalRank }) =>
    a.rank.tier - b.rank.tier || a.rank.urgency - b.rank.urgency ||
    Date.parse(a.row.created_at) - Date.parse(b.row.created_at) || a.row.id.localeCompare(b.row.id);
  let ranked = rows.filter(row => row.status === "pending" && !row.schedule_locked).map(row => ({
    row, rank: rankSeasonalProduct(classifications.get(row.etsy_listing_id), policy, now)
  })).sort(compare);
  const occupied = rows.filter(row => row.schedule_locked || row.status === "processing")
    .map(row => Date.parse(row.scheduled_at)).filter(Number.isFinite);
  const start = getNextScheduleStart(intervalMinutes, now);
  const intervalMs = intervalMinutes * 60_000;
  let slot = 0;
  let rankedDay = marketDay(now);
  const plan: Array<T & { seasonalRank: SeasonalRank }> = [];
  while (ranked.length) {
    let scheduledAt = buildScheduledAt(slot++, intervalMinutes, start);
    while (occupied.some(time => Math.abs(time - Date.parse(scheduledAt)) < intervalMs)) {
      scheduledAt = buildScheduledAt(slot++, intervalMinutes, start);
    }
    const slotDate = new Date(scheduledAt);
    if (marketDay(slotDate) !== rankedDay) {
      rankedDay = marketDay(slotDate);
      // A long backlog must not retain yesterday's expired delivery priority.
      ranked = ranked.map(({ row }) => ({ row, rank: rankSeasonalProduct(classifications.get(row.etsy_listing_id), policy, slotDate) })).sort(compare);
    }
    const { row, rank } = ranked.shift()!;
    plan.push({ ...row, scheduled_at: scheduledAt, seasonalRank: rank });
  }
  return plan;
}
