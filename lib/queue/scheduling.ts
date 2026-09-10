import type { NormalizedEtsyListing } from "@/lib/etsy/types";

export const DEFAULT_QUEUE_INTERVAL_MINUTES = 15;

const EVENT_RULES: Array<{ priority: number; pattern: RegExp }> = [
  { priority: 10, pattern: /\b(october|halloween)\b/i },
  { priority: 12, pattern: /\b(breast cancer|pink ribbon)\b/i },
  { priority: 20, pattern: /\b(november|thanksgiving|friendsgiving|turkeys?|veterans?(?:'s)? day|black friday)\b/i },
  { priority: 30, pattern: /\b(december|christmas|xmas|holidays?|ornaments?|santa|hanukkah)\b/i },
  { priority: 40, pattern: /\b(new year(?:'s)?|new years eve|nye)\b/i },
  { priority: 50, pattern: /\b(september|patriot(?:'s)? day|9[\s/-]?11|grandparents?(?:'s)? day|labor day)\b/i },
  { priority: 70, pattern: /\b(?:100|one hundred|hundred)(?:th)?[ -]days?(?:[ -]of[ -]school)?\b|\b100th[ -]day(?:[ -]of[ -]school)?\b/i },
  { priority: 60, pattern: /\b(back[ -]to[ -]school|first day of school)\b/i }
];

const SEASONAL_FALLBACK_RULES: Array<{ priority: number; pattern: RegExp }> = [
  { priority: 10, pattern: /\b(spooky|ghosts?|witch(?:es)?|costumes?|skeletons?|skulls?|haunted|horror|boo)\b|\btrick[ -]or[ -]treat\b|\bjack[ -]o[ -]lanterns?\b/i },
  { priority: 15, pattern: /\b(fall|autumn|pumpkins?)\b/i },
  { priority: 25, pattern: /\bharvest\b/i },
  { priority: 45, pattern: /\bwinter\b/i },
  { priority: 65, pattern: /\b(school|teacher|classroom)\b/i }
];

export function getSeasonalQueuePriority(listing: Pick<NormalizedEtsyListing, "title" | "description" | "originalCreationTimestamp">) {
  const text = listing.title;
  const matched = EVENT_RULES.find((rule) => rule.pattern.test(text));

  if (matched) {
    return matched.priority;
  }

  return SEASONAL_FALLBACK_RULES.find((rule) => rule.pattern.test(text))?.priority ?? 100;
}

export function sortListingsForQueue(listings: NormalizedEtsyListing[]) {
  return [...listings].sort((first, second) => {
    const priorityDiff = getSeasonalQueuePriority(first) - getSeasonalQueuePriority(second);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (second.originalCreationTimestamp ?? 0) - (first.originalCreationTimestamp ?? 0);
  });
}

export function buildScheduledAt(index: number, intervalMinutes = DEFAULT_QUEUE_INTERVAL_MINUTES, startDate = new Date()) {
  return new Date(startDate.getTime() + index * intervalMinutes * 60_000).toISOString();
}

export function getNextScheduleStart(
  intervalMinutes = DEFAULT_QUEUE_INTERVAL_MINUTES,
  fromDate = new Date()
) {
  const intervalMs = intervalMinutes * 60_000;
  return new Date(Math.ceil(fromDate.getTime() / intervalMs) * intervalMs);
}

export type QueueSortableItem = {
  title: string;
  description: string | null;
  created_at?: string;
  scheduled_at?: string;
};

export function sortQueueRowsForPublishing<T extends QueueSortableItem>(items: T[]) {
  return [...items].sort((first, second) => {
    const firstPriority = getSeasonalQueuePriority({
      title: first.title,
      description: first.description,
      originalCreationTimestamp: null
    });
    const secondPriority = getSeasonalQueuePriority({
      title: second.title,
      description: second.description,
      originalCreationTimestamp: null
    });
    const priorityDiff = firstPriority - secondPriority;

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const firstCreatedAt = new Date(first.created_at ?? first.scheduled_at ?? 0).getTime();
    const secondCreatedAt = new Date(second.created_at ?? second.scheduled_at ?? 0).getTime();

    return firstCreatedAt - secondCreatedAt;
  });
}
