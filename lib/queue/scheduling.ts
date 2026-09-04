import type { NormalizedEtsyListing } from "@/lib/etsy/types";

export const DEFAULT_QUEUE_INTERVAL_MINUTES = 15;

const SEASONAL_RULES: Array<{ priority: number; pattern: RegExp }> = [
  { priority: 10, pattern: /\b(september|back to school|school|teacher|classroom|fall|autumn|labor day|patriot day|grandparents)\b/i },
  { priority: 20, pattern: /\b(october|halloween|spooky|pumpkin|ghost|witch|costume)\b/i },
  { priority: 30, pattern: /\b(november|thanksgiving|veterans|autumn|fall|harvest|black friday)\b/i },
  { priority: 40, pattern: /\b(december|christmas|xmas|holiday|ornament|santa|winter|new year)\b/i }
];

export function getSeasonalQueuePriority(listing: Pick<NormalizedEtsyListing, "title" | "description" | "originalCreationTimestamp">) {
  const text = `${listing.title} ${listing.description ?? ""}`;
  const matched = SEASONAL_RULES.find((rule) => rule.pattern.test(text));

  if (matched) {
    return matched.priority;
  }

  return 100;
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
