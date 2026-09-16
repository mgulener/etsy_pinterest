export const CALENDAR_VERSION = "us-2026-09-v1";
const DAY = 86_400_000;

const fixed = (month: number, day: number) => (year: number) => Date.UTC(year, month - 1, day);
function weekday(month: number, day: number, occurrence: number) {
  return (year: number) => {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return Date.UTC(year, month - 1, 1 + (day - first + 7) % 7 + (occurrence - 1) * 7);
  };
}
const lastMondayInMay = (year: number) => {
  const last = new Date(Date.UTC(year, 4, 31));
  return last.getTime() - (last.getUTCDay() + 6) % 7 * DAY;
};

// Actual observance dates, not substitute federal office-closure dates.
// Sources and deliberately approximate seasonal windows: docs/seasonal-scheduling.md.
export const EVENTS = {
  new_year: { label: "New Year's Day", start: fixed(1, 1) },
  mlk_day: { label: "Martin Luther King Jr. Day", start: weekday(1, 1, 3) },
  valentines: { label: "Valentine's Day", start: fixed(2, 14) },
  presidents_day: { label: "Presidents' Day", start: weekday(2, 1, 3) },
  st_patricks: { label: "St. Patrick's Day", start: fixed(3, 17) },
  military_child_month: { label: "Month of the Military Child", start: fixed(4, 1), end: fixed(4, 30) },
  mothers_day: { label: "Mother's Day", start: weekday(5, 0, 2) },
  memorial_day: { label: "Memorial Day", start: lastMondayInMay },
  juneteenth: { label: "Juneteenth", start: fixed(6, 19) },
  fathers_day: { label: "Father's Day", start: weekday(6, 0, 3) },
  independence_day: { label: "US Independence Day", start: fixed(7, 4) },
  labor_day: { label: "US Labor Day", start: weekday(9, 1, 1) },
  grandparents_day: { label: "Grandparents Day", start: (year: number) => weekday(9, 1, 1)(year) + 6 * DAY },
  patriot_day: { label: "Patriot Day / September 11", start: fixed(9, 11) },
  breast_cancer_month: { label: "Breast Cancer Awareness Month", start: fixed(10, 1), end: fixed(10, 31) },
  halloween: { label: "Halloween", start: fixed(10, 31) },
  veterans_day: { label: "Veterans Day", start: fixed(11, 11) },
  thanksgiving: { label: "US Thanksgiving / Friendsgiving", start: weekday(11, 4, 4) },
  black_friday: { label: "Black Friday", start: (year: number) => weekday(11, 4, 4)(year) + DAY },
  christmas: { label: "Christmas", start: fixed(12, 25) },
  new_years_eve: { label: "New Year's Eve", start: fixed(12, 31) },
  spring: { label: "Spring (March-May planning window)", start: fixed(3, 1), end: fixed(5, 31) },
  summer: { label: "Summer (June-August planning window)", start: fixed(6, 1), end: fixed(8, 31) },
  autumn: { label: "Fall / harvest (September-November planning window)", start: fixed(9, 1), end: fixed(11, 30) },
  winter: { label: "Winter (December-February planning window)", start: fixed(12, 1), end: (year: number) => Date.UTC(year + 1, 2, 0) }
} satisfies Record<string, { label: string; start: (year: number) => number; end?: (year: number) => number }>;

export type EventId = keyof typeof EVENTS;
export const EVENT_IDS = Object.keys(EVENTS) as EventId[];
export function isEventId(value: unknown): value is EventId {
  return typeof value === "string" && Object.hasOwn(EVENTS, value);
}

export function eventOccurrence(id: EventId, year: number) {
  const event = EVENTS[id];
  const start = event.start(year);
  const end = "end" in event ? event.end(year) : start;
  return { start, end };
}

// Calendar arithmetic stays date-only, so DST never adds/removes a planning day.
export function marketDay(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid scheduling date.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const part = (name: string) => Number(parts.find(item => item.type === name)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

export const calendarDays = (count: number) => count * DAY;
export const calendarDate = (value: number) => new Date(value).toISOString().slice(0, 10);
